// Registro de activación UTPL (1 día). Sin dependencias externas.
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const ADMIN_KEY = process.env.ADMIN_KEY || 'cambia-esta-clave';
const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, 'registros.json');
const PUBLIC = path.join(__dirname, 'public');

const CARRERAS = [
  'Administración de Empresas','Contabilidad y Auditoría','Economía','Mercadotecnia',
  'Derecho','Psicología','Educación','Comunicación',
  'Arquitectura','Ingeniería Civil','Ingeniería en Sistemas','Ingeniería Industrial',
  'Ingeniería Electrónica','Medicina','Enfermería','Odontología',
  'Nutrición y Dietética','Biología','Química','Gastronomía',
  'Turismo y Hotelería','Diseño Gráfico','Artes Visuales'
];

let registros = [];
try { registros = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); } catch (_) {}
const save = () => fs.writeFileSync(DATA_FILE, JSON.stringify(registros, null, 2));

const hits = new Map(); // rate limit: 10 envíos / 10 min / IP
function limited(ip) {
  const now = Date.now();
  const arr = (hits.get(ip) || []).filter(t => now - t < 600000);
  arr.push(now); hits.set(ip, arr);
  return arr.length > 10;
}

const send = (res, code, body, type = 'application/json') => {
  res.writeHead(code, { 'Content-Type': type + '; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
};
const authed = (req, url) => {
  const k = req.headers['x-admin-key'] || url.searchParams.get('key') || '';
  const a = Buffer.from(k), b = Buffer.from(ADMIN_KEY);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};
const csvCell = v => { let s = String(v); if (/^[=+\-@]/.test(s)) s = "'" + s; return '"' + s.replace(/"/g, '""') + '"'; };

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');

  if (req.method === 'GET' && url.pathname === '/api/carreras') return send(res, 200, CARRERAS);

  if (req.method === 'POST' && url.pathname === '/api/registro') {
    const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
    if (limited(ip)) return send(res, 429, { error: 'Demasiados intentos. Intenta más tarde.' });
    let raw = '';
    req.on('data', c => { raw += c; if (raw.length > 5000) req.destroy(); });
    req.on('end', () => {
      let d; try { d = JSON.parse(raw); } catch { return send(res, 400, { error: 'Solicitud inválida.' }); }
      const nombre = String(d.nombre || '').trim().replace(/\s+/g, ' ');
      const telefono = String(d.telefono || '').trim();
      const carrera = String(d.carrera || '');
      if (nombre.length < 3 || nombre.length > 80 || !nombre.includes(' ')) return send(res, 400, { error: 'Ingresa nombre y apellido.' });
      if (!/^09\d{8}$/.test(telefono)) return send(res, 400, { error: 'El teléfono debe tener 10 dígitos y empezar con 09.' });
      if (!CARRERAS.includes(carrera)) return send(res, 400, { error: 'Selecciona una carrera.' });
      if (d.autorizacion !== true) return send(res, 400, { error: 'Debes autorizar el tratamiento de tus datos.' });
      if (registros.some(r => r.telefono === telefono)) return send(res, 409, { error: 'Este teléfono ya está registrado.' });
      registros.push({ id: registros.length + 1, fecha: new Date().toISOString(), nombre, telefono, carrera, autorizacion: true });
      save();
      send(res, 201, { ok: true });
    });
    return;
  }

  if (url.pathname === '/api/informe') {
    if (!authed(req, url)) return send(res, 401, { error: 'No autorizado.' });
    return send(res, 200, registros);
  }
  if (url.pathname === '/api/informe.csv') {
    if (!authed(req, url)) return send(res, 401, { error: 'No autorizado.' });
    const rows = [['id','fecha_ec','nombre','telefono','carrera','autorizacion']].concat(
      registros.map(r => [r.id, new Date(r.fecha).toLocaleString('es-EC', { timeZone: 'America/Guayaquil' }), r.nombre, r.telefono, r.carrera, 'sí']));
    res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="registros.csv"' });
    return res.end('﻿' + rows.map(r => r.map(csvCell).join(',')).join('\n'));
  }

  const file = url.pathname === '/' ? 'index.html' : url.pathname === '/informe' ? 'informe.html' : null;
  if (file) return send(res, 200, fs.readFileSync(path.join(PUBLIC, file), 'utf8'), 'text/html');
  send(res, 404, 'No encontrado', 'text/plain');
}).listen(PORT, () => console.log('Activación en puerto ' + PORT));
