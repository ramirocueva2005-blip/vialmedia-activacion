// Registro de activación UTPL (1 día). Sin dependencias externas.
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const ADMIN_KEY = process.env.ADMIN_KEY || 'cambia-esta-clave';
const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, 'registros.json');
const PUBLIC = path.join(__dirname, 'public');

const CATALOGO = JSON.parse(fs.readFileSync(path.join(__dirname, 'catalogo.json'), 'utf8'));
const LIBRES = ['Formación permanente']; // sin listado: el programa se escribe a mano

function cedulaValida(c) {
  if (!/^\d{10}$/.test(c)) return false;
  const prov = +c.slice(0, 2);
  if (!((prov >= 1 && prov <= 24) || prov === 30)) return false;
  if (+c[2] > 5) return false;
  let sum = 0;
  for (let i = 0; i < 9; i++) { let v = +c[i] * (i % 2 === 0 ? 2 : 1); if (v > 9) v -= 9; sum += v; }
  return ((10 - (sum % 10)) % 10) === +c[9];
}

const ACT_FILE = process.env.ACT_FILE || path.join(path.dirname(DATA_FILE), 'activadoras.json');
let activadoras = [{ id: 'a1', nombre: 'Ana' }, { id: 'a2', nombre: 'Julia' }, { id: 'a3', nombre: 'María' }, { id: 'a4', nombre: 'Daniela' }];
try {
  const saved = JSON.parse(fs.readFileSync(ACT_FILE, 'utf8'));
  activadoras = activadoras.map(a => { const x = saved.find(y => y.id === a.id); return x ? { id: a.id, nombre: x.nombre } : a; });
} catch (_) {}
const saveAct = () => fs.writeFileSync(ACT_FILE, JSON.stringify(activadoras, null, 2));

let registros = [];
try { registros = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); } catch (_) {}
const save = () => fs.writeFileSync(DATA_FILE, JSON.stringify(registros, null, 2));

const hits = new Map(); // anti-abuso: 1500 envíos / 10 min / IP (el WiFi del evento comparte una sola IP)
function limited(ip) {
  const now = Date.now();
  const arr = (hits.get(ip) || []).filter(t => now - t < 600000);
  arr.push(now); hits.set(ip, arr);
  return arr.length > 1500;
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
const csvCell = v => { let s = String(v); if (/^\d{10}$/.test(s)) return '="' + s + '"'; if (/^[=+\-@]/.test(s)) s = "'" + s; return '"' + s.replace(/"/g, '""') + '"'; };

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');

  if (req.method === 'GET' && url.pathname === '/api/catalogo') return send(res, 200, { catalogo: CATALOGO, libres: LIBRES });

  if (req.method === 'POST' && url.pathname === '/api/registro') {
    const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
    if (limited(ip)) return send(res, 429, { error: 'Demasiados intentos. Intenta más tarde.' });
    let raw = '';
    req.on('data', c => { raw += c; if (raw.length > 5000) req.destroy(); });
    req.on('end', () => {
      let d; try { d = JSON.parse(raw); } catch { return send(res, 400, { error: 'Solicitud inválida.' }); }
      const nombre = String(d.nombre || '').trim().replace(/\s+/g, ' ');
      const cedula = String(d.cedula || '').trim();
      const correo = String(d.correo || '').trim().toLowerCase();
      const telefono = String(d.telefono || '').trim();
      const modalidad = String(d.modalidad || '');
      const carrera = String(d.carrera || '').trim().replace(/\s+/g, ' ');
      if (nombre.length < 3 || nombre.length > 80 || !nombre.includes(' ')) return send(res, 400, { error: 'Ingresa nombres y apellidos.' });
      if (!cedulaValida(cedula)) return send(res, 400, { error: 'El número de cédula no es válido.' });
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(correo) || correo.length > 100) return send(res, 400, { error: 'Ingresa un correo electrónico válido.' });
      if (!/^09\d{8}$/.test(telefono)) return send(res, 400, { error: 'El teléfono debe tener 10 dígitos y empezar con 09.' });
      if (!Object.prototype.hasOwnProperty.call(CATALOGO, modalidad)) return send(res, 400, { error: 'Selecciona una modalidad.' });
      if (LIBRES.includes(modalidad)) { if (carrera.length < 3 || carrera.length > 100) return send(res, 400, { error: 'Escribe el programa de tu interés.' }); }
      else if (!CATALOGO[modalidad].includes(carrera)) return send(res, 400, { error: 'Selecciona una carrera o programa.' });
      if (d.autorizacion !== true) return send(res, 400, { error: 'Debes autorizar el tratamiento de tus datos.' });
      if (registros.some(r => r.cedula === cedula)) return send(res, 409, { error: 'Esta cédula ya está registrada.' });
      const act = activadoras.some(x => x.id === d.a) ? d.a : null;
      registros.push({ id: registros.length + 1, fecha: new Date().toISOString(), nombre, cedula, correo, telefono, modalidad, carrera, activadora: act, autorizacion: true });
      save();
      send(res, 201, { ok: true });
    });
    return;
  }

  if (url.pathname === '/api/informe') {
    if (!authed(req, url)) return send(res, 401, { error: 'No autorizado.' });
    return send(res, 200, { registros, activadoras });
  }
  if (req.method === 'POST' && url.pathname === '/api/cargar-ejemplo') {
    if (!authed(req, url)) return send(res, 401, { error: 'No autorizado.' });
    if (registros.length) return send(res, 409, { error: 'Solo se puede cargar con el panel vacío.' });
    try { registros = JSON.parse(fs.readFileSync(path.join(__dirname, 'demo.json'), 'utf8')); } catch { return send(res, 500, { error: 'Sin datos de ejemplo.' }); }
    save();
    return send(res, 200, { cargados: registros.length });
  }
  if (req.method === 'POST' && url.pathname === '/api/eliminar') {
    if (!authed(req, url)) return send(res, 401, { error: 'No autorizado.' });
    let raw = '';
    req.on('data', c => { raw += c; if (raw.length > 50000) req.destroy(); });
    req.on('end', () => {
      let d; try { d = JSON.parse(raw); } catch { return send(res, 400, { error: 'Solicitud inválida.' }); }
      const antes = registros.length;
      try { fs.writeFileSync(DATA_FILE + '.bak', JSON.stringify(registros)); } catch (_) {}
      if (d.todos === true) registros = [];
      else if (Array.isArray(d.ids) && d.ids.length) { const set = new Set(d.ids.map(Number)); registros = registros.filter(r => !set.has(r.id)); }
      else return send(res, 400, { error: 'Nada que eliminar.' });
      save();
      send(res, 200, { eliminados: antes - registros.length, quedan: registros.length });
    });
    return;
  }
  if (req.method === 'PUT' && url.pathname === '/api/activadoras') {
    if (!authed(req, url)) return send(res, 401, { error: 'No autorizado.' });
    let raw = '';
    req.on('data', c => { raw += c; if (raw.length > 5000) req.destroy(); });
    req.on('end', () => {
      let d; try { d = JSON.parse(raw); } catch { return send(res, 400, { error: 'Solicitud inválida.' }); }
      const list = Array.isArray(d.activadoras) ? d.activadoras : [];
      const next = activadoras.map(a => {
        const x = list.find(y => y && y.id === a.id);
        const n = x ? String(x.nombre || '').trim().replace(/\s+/g, ' ') : '';
        return { id: a.id, nombre: n.length >= 1 && n.length <= 40 ? n : a.nombre };
      });
      activadoras = next; saveAct();
      send(res, 200, { activadoras });
    });
    return;
  }
  if (url.pathname === '/api/informe.csv') {
    if (!authed(req, url)) return send(res, 401, { error: 'No autorizado.' });
    const rows = [['id','fecha_ec','nombre','cedula','correo','telefono','modalidad','carrera','activadora','autorizacion']].concat(
      registros.map(r => [r.id, new Date(r.fecha).toLocaleString('es-EC', { timeZone: 'America/Guayaquil' }), r.nombre, r.cedula, r.correo, r.telefono, r.modalidad, r.carrera, (activadoras.find(a => a.id === r.activadora) || {}).nombre || 'Sin asignar', 'sí']));
    res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="registros.csv"' });
    return res.end('﻿' + rows.map(r => r.map(csvCell).join(',')).join('\n'));
  }

  if (url.pathname === '/qrcode.js') {
    res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8', 'Cache-Control': 'public, max-age=86400' });
    return res.end(fs.readFileSync(path.join(PUBLIC, 'qrcode.js')));
  }
  const file = url.pathname === '/' ? 'index.html' : url.pathname === '/informe' ? 'informe.html' : null;
  if (file) return send(res, 200, fs.readFileSync(path.join(PUBLIC, file), 'utf8'), 'text/html');
  send(res, 404, 'No encontrado', 'text/plain');
}).listen(PORT, () => console.log('Activación en puerto ' + PORT));
