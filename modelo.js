let movimientos = [];
let cargando = true;
let chartInstance = null;
let filtroActual = 'hoy';
let rangoCustom = {desde:null, hasta:null};
const DEFAULT_LIMITE = 500;
const DEFAULT_META = 10000;
function cargarConfig(){
  const cfg=JSON.parse(localStorage.getItem("taxi_config")||"{}");
  return {limite:cfg.limite??DEFAULT_LIMITE, meta:cfg.meta??DEFAULT_META};
}
let {limite:LIMITE_INFERIOR, meta:META_MAXIMA}=cargarConfig();
function guardarConfig(limite,meta){
  localStorage.setItem("taxi_config", JSON.stringify({limite,meta}));
  LIMITE_INFERIOR=limite; META_MAXIMA=meta;
}
async function sha256(str) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map(b=>b.toString(16).padStart(2,"0")).join("");
}
const PASSWORD_HASH = "d87c87b2a681cf50f6c5dff7e36700d4082cf04c6f779d8f7c2c1cc94ceb86a4";

// --- CAMBIO 1: CARGAR DE LA NUBE COMPARTIDA ---
async function cargarNube() {
  try {
    const { onSnapshot } = window.dbTools;
    onSnapshot(window.colRef, (snap) => {
      movimientos = snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a,b) => new Date(b.fecha) - new Date(a.fecha));
      cargando = false;
      render();
      mostrarEstado("Compartido ✓","ok");
    });
  } catch (e) { 
    console.error(e);
    mostrarEstado("Error conectando","error");
    cargando = false;
    render();
  }
}

// --- YA NO SE USA, AHORA TODO VA DIRECTO A FIREBASE ---
async function guardarNube() {
  render();
}

function mostrarEstado(msg, tipo){
  const el = document.getElementById("estado-nube");
  if(el){ el.textContent = msg; el.className = "estado "+tipo; setTimeout(()=>el.textContent="",3000); }
}

// --- CAMBIO 2: GUARDAR EN LA NUBE COMPARTIDA ---
async function agregarMovimiento(tipo, concepto, monto){
  if(!concepto || !monto) return;
  const { addDoc } = window.dbTools;
  await addDoc(window.colRef, {tipo, concepto, monto:parseFloat(monto), fecha:new Date().toISOString()});
}

async function eliminarMovimiento(id){ 
  const { deleteDoc, doc, db } = window.dbTools;
  await deleteDoc(doc(db, "movimientos", id)); 
}

async function limpiarMovimientos(){
  if(movimientos.length===0) return;
  if(confirm(`¿Borrar TODOS los ${movimientos.length} movimientos? Esto lo borra para los dos.`)){
    const { getDocs, writeBatch } = window.dbTools;
    const snap = await getDocs(window.colRef);
    const batch = writeBatch(window.dbTools.db);
    snap.forEach(d => batch.delete(d.ref));
    await batch.commit();
  }
}
window.limpiarMovimientos = limpiarMovimientos;

function obtenerRangoFiltro(){
  const hoy = new Date(); hoy.setHours(0,0,0,0);
  let inicio = new Date(hoy), fin = new Date(); fin.setHours(23,59,59,999);
  if(filtroActual==='semana'){ inicio.setDate(hoy.getDate()-6); }
  else if(filtroActual==='mes'){ inicio = new Date(hoy.getFullYear(), hoy.getMonth(), 1); }
  else if(filtroActual==='todo'){ inicio = new Date(2000,0,1); }
  else if(filtroActual==='custom' && rangoCustom.desde && rangoCustom.hasta){
    inicio = new Date(rangoCustom.desde); inicio.setHours(0,0,0,0);
    fin = new Date(rangoCustom.hasta); fin.setHours(23,59,59,999);
  }
  return {inicio, fin};
}
function movimientosEnRango(){
  const {inicio, fin} = obtenerRangoFiltro();
  return movimientos.filter(m=>{ const f = new Date(m.fecha); return f >= inicio && f <= fin; });
}
function calcularTotales(lista){
  let ingresos=0,gastos=0;
  lista.forEach(m=>{ if(m.tipo==="ingreso") ingresos+=m.monto; else gastos+=m.monto; });
  return {ingresos,gastos,saldo:ingresos-gastos};
}
function actualizarGrafica(){
  const canvas = document.getElementById("grafica");
  if(!canvas) return;
  const titulo = document.getElementById("titulo-grafica");
  let dias = []; let labels = [];
  const movsRango = movimientosEnRango();
  if(filtroActual==='hoy'){
    for(let h=0;h<24;h++){ dias.push(h); labels.push(h+':00'); }
    const mapaIng = Array(24).fill(0), mapaGas = Array(24).fill(0);
    movsRango.forEach(m=>{ const hh = new Date(m.fecha).getHours(); if(m.tipo==='ingreso') mapaIng[hh]+=m.monto; else mapaGas[hh]+=m.monto; });
    var dataIng = mapaIng, dataGas = mapaGas;
    if(titulo) titulo.textContent = '📈 Hoy por horas';
    var dataSaldo = (()=>{ let ac=movimientos.filter(m=>new Date(m.fecha)<obtenerRangoFiltro().inicio).reduce((s,m)=>s+(m.tipo==="ingreso"?m.monto:-m.monto),0); let arr=Array(24).fill(ac); let porHora={}; movsRango.forEach(m=>{ const h=new Date(m.fecha).getHours(); if(!porHora[h]) porHora[h]=[]; porHora[h].push(m); }); for(let h=0;h<24;h++){ if(porHora[h]) porHora[h].forEach(m=>{ac+=m.tipo==="ingreso"?m.monto:-m.monto}); arr[h]=ac; } return arr; })();
  } else {
    const {inicio, fin} = obtenerRangoFiltro();
    const diff = Math.ceil((fin-inicio)/(1000*60*60*24));
    const maxDias = filtroActual==='todo' ? 30 : Math.min(diff, 31);
    const mapaIng = {}, mapaGas = {};
    for(let i=maxDias-1;i>=0;i--){
      const d = new Date(); if(filtroActual!=='todo') d.setTime(fin.getTime()); else { d.setDate(new Date().getDate()-i); }
      if(filtroActual!=='todo'){ d.setDate(fin.getDate()-i); }
      if(d < inicio) continue;
      const key = d.toLocaleDateString('es-MX',{day:'2-digit',month:'short'});
      const iso = d.toISOString().slice(0,10);
      dias.push({label:key, iso}); mapaIng[iso]=0; mapaGas[iso]=0;
    }
    movsRango.forEach(m=>{ const iso = m.fecha.slice(0,10); if(mapaIng.hasOwnProperty(iso)){ if(m.tipo==="ingreso") mapaIng[iso]+=m.monto; else mapaGas[iso]+=m.monto; } });
    labels = dias.map(d=>d.label);
    var dataIng = dias.map(d=>mapaIng[d.iso]);
    var dataGas = dias.map(d=>mapaGas[d.iso]);
    if(titulo) titulo.textContent = filtroActual==='semana'?'📈 Últimos 7 días':filtroActual==='mes'?'📈 Este mes':'📈 '+labels.length+' días';
    let ac=0; const mapaSaldo={}; dias.forEach(d=>mapaSaldo[d.iso]=0);
    let saldoPrevio = movimientos.filter(m=> new Date(m.fecha) < inicio).reduce((s,m)=> s + (m.tipo==="ingreso"?m.monto:-m.monto),0);
    dias.forEach(d=>{ const delDia = movsRango.filter(m=>m.fecha.slice(0,10)===d.iso); delDia.forEach(m=>{ ac += (m.tipo==="ingreso"? m.monto : -m.monto) }); mapaSaldo[d.iso]=ac+saldoPrevio; });
    var dataSaldo = dias.map(d=>mapaSaldo[d.iso]);
  }
  if(chartInstance) chartInstance.destroy();
  chartInstance = new Chart(canvas, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        { label: 'Ingresos', data: dataIng, backgroundColor: '#22c55e', type:'bar', order:2 },
        { label: 'Gastos', data: dataGas, backgroundColor: '#ef4444', type:'bar', order:2 },
        { label: 'Saldo', data: dataSaldo, borderColor: '#ffffff', backgroundColor: '#ffffff', type:'line', tension:0.3, borderWidth:2, pointRadius:3, order:1 },
        { label: `Meta $${META_MAXIMA}`, data: Array(labels.length).fill(META_MAXIMA), borderColor: '#22c55e', borderDash:[6,6], type:'line', pointRadius:0, borderWidth:1.5, order:0 },
        { label: `Mínimo $${LIMITE_INFERIOR}`, data: Array(labels.length).fill(LIMITE_INFERIOR), borderColor: '#f59e0b', borderDash:[6,6], type:'line', pointRadius:0, borderWidth:1.5, order:0 }
      ]
    },
    options: { responsive:true, maintainAspectRatio:false, plugins:{ legend:{ labels:{ color:'#fff', font:{size:11} } } }, scales:{ x:{ ticks:{ color:'#888', maxTicksLimit: 12 }, grid:{ color:'#222' } }, y:{ ticks:{ color:'#888' }, grid:{ color:'#222' } } } }
  });
}
function render(){
  const lista = document.getElementById("lista");
  if(!lista) return;
  const {inicio, fin} = obtenerRangoFiltro();
  const filtrados = movimientosEnRango();
  const {ingresos,gastos,saldo} = calcularTotales(filtrados);
  const totalesGenerales = calcularTotales(movimientos);
  document.getElementById("total-ingresos").textContent = `$${ingresos.toFixed(2)}`;
  document.getElementById("total-gastos").textContent = `$${gastos.toFixed(2)}`;
  const elSal = document.getElementById("total-saldo"); elSal.textContent = `$${saldo.toFixed(2)}`; elSal.style.color = saldo < LIMITE_INFERIOR? '#ef4444' : '#22c55e';
  const label = document.getElementById("periodo-label"); if(label){ if(filtroActual==='hoy') label.textContent = 'Hoy'; else if(filtroActual==='semana') label.textContent = 'Esta semana'; else if(filtroActual==='mes') label.textContent = 'Este mes'; else if(filtroActual==='todo') label.textContent = 'Todo'; else label.textContent = `${inicio.toLocaleDateString()} - ${fin.toLocaleDateString()}`; }
  const gan = document.getElementById("ganancia-periodo"); if(gan) gan.textContent = `$${saldo.toFixed(2)}`;
  if(cargando){ lista.innerHTML = "<p class='vacio'>Cargando...</p>"; return; }
  if(filtrados.length===0){ lista.innerHTML = `<p class='vacio'>Sin movimientos en este periodo.<br><small>Total histórico: $${totalesGenerales.saldo.toFixed(2)}</small></p>`; }
  else { lista.innerHTML = filtrados.map(m=>`<div class="mov ${m.tipo}"><div><strong>${m.concepto}</strong><br><small>${new Date(m.fecha).toLocaleString()}</small></div><div class="monto ${m.tipo}">${m.tipo==="gasto"?"-":"+"}$${m.monto.toFixed(2)} <button onclick="eliminarMovimiento('${m.id}')">x</button></div></div>`).join(""); }
  actualizarGrafica();
}
function setFiltro(tipo){
  filtroActual = tipo;
  document.querySelectorAll('.filtros-botones button').forEach(b=>b.classList.remove('activo'));
  document.getElementById('btn-'+tipo)?.classList.add('activo');
  const customDiv = document.getElementById('fechas-custom');
  if(tipo==='custom'){ customDiv.classList.add('activo'); }
  else { customDiv.classList.remove('activo'); render(); }
}
function aplicarCustom(){
  const d = document.getElementById('fecha-desde').value;
  const h = document.getElementById('fecha-hasta').value;
  if(!d || !h){ alert('Selecciona ambas fechas'); return; }
  rangoCustom.desde = d; rangoCustom.hasta = h; render();
}
async function verificarPassword(){
  const pass = document.getElementById("pass-input").value;
  if(pass==="qrbp_5els" || await sha256(pass)===PASSWORD_HASH){
    document.getElementById("login-screen").style.display="none";
    document.getElementById("app-screen").style.display="flex";
    cargarNube();
  } else { alert("Contraseña incorrecta"); }
}
window.agregarMovimiento = agregarMovimiento;
window.eliminarMovimiento = eliminarMovimiento;
window.verificarPassword = verificarPassword;
window.cargarNube = cargarNube;
window.setFiltro = setFiltro;
window.aplicarCustom = aplicarCustom;
document.addEventListener("DOMContentLoaded", ()=>{
  const form = document.getElementById("form-mov");
  if(form){
    form.addEventListener("submit", (e)=>{
      e.preventDefault();
      agregarMovimiento(document.getElementById("tipo").value, document.getElementById("concepto").value, document.getElementById("monto").value);
      form.reset();
    });
  }
  document.getElementById("btn-agregar")?.addEventListener("click", (e)=>{
    if(form) return;
    e.preventDefault();
    agregarMovimiento(document.getElementById("tipo").value, document.getElementById("concepto").value, document.getElementById("monto").value);
  });
});
function abrirAjustes(){
  document.getElementById("input-minimo").value = LIMITE_INFERIOR;
  document.getElementById("input-meta").value = META_MAXIMA;
  document.getElementById("modal-ajustes").style.display="flex";
}
function cerrarAjustes(){ document.getElementById("modal-ajustes").style.display="none"; }
function guardarAjustes(){
  const nuevoMin = parseFloat(document.getElementById("input-minimo").value) || DEFAULT_LIMITE;
  const nuevaMeta = parseFloat(document.getElementById("input-meta").value) || DEFAULT_META;
  guardarConfig(nuevoMin, nuevaMeta); cerrarAjustes(); render();
  mostrarEstado(`Meta: $${nuevaMeta} | Mínimo: $${nuevoMin}`, "ok");
}
window.abrirAjustes = abrirAjustes;
window.cerrarAjustes = cerrarAjustes;
window.guardarAjustes = guardarAjustes;