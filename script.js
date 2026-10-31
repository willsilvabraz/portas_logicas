/* Logic Simulator — motor de circuito, editor SVG e persistência */
(() => {
  "use strict";
  const $ = (s, root=document) => root.querySelector(s);
  const $$ = (s, root=document) => [...root.querySelectorAll(s)];
  const viewport = $("#viewport"), stage = $("#stage"), nodesLayer = $("#nodesLayer");
  const wireLayer = $("#wireLayer"), draftWire = $("#draftWire");
  const inspector = $("#inspectorContent"), truthContent = $("#truthContent");
  const state = {nodes:[], wires:[], selected:new Set(), primary:null, nextId:1, zoom:1, pan:{x:0,y:0}, grid:true, clockTimer:null};
  const history = {undo:[], redo:[], limit:80};
  const INPUT_TYPES = ["INPUT","CLOCK"], GATES = ["AND","OR","NOT","NAND","NOR","XOR","XNOR"];
  const META = {
    AND:{inputs:2,expr:"A · B"}, OR:{inputs:2,expr:"A + B"}, NOT:{inputs:1,expr:"¬A"},
    NAND:{inputs:2,expr:"¬(A · B)"}, NOR:{inputs:2,expr:"¬(A + B)"},
    XOR:{inputs:2,expr:"A ⊕ B"}, XNOR:{inputs:2,expr:"¬(A ⊕ B)"}
  };
  let interaction = null, spaceDown=false, toastTimer=null;

  function uid(){ return state.nextId++; }
  function snap(){return JSON.stringify({nodes:state.nodes,wires:state.wires,nextId:state.nextId});}
  function checkpoint(){history.undo.push(snap());if(history.undo.length>history.limit)history.undo.shift();history.redo=[];updateHistoryButtons();}
  function restore(raw){const d=JSON.parse(raw);state.nodes=d.nodes||[];state.wires=d.wires||[];state.nextId=d.nextId||1;state.selected.clear();state.primary=null;renderAll();simulate();updateInspector();}
  function undo(){if(!history.undo.length)return;history.redo.push(snap());restore(history.undo.pop());updateHistoryButtons();toast("Ação desfeita");}
  function redo(){if(!history.redo.length)return;history.undo.push(snap());restore(history.redo.pop());updateHistoryButtons();toast("Ação refeita");}
  function updateHistoryButtons(){$("#undoBtn").disabled=!history.undo.length;$("#redoBtn").disabled=!history.redo.length;}
  function toast(msg){const el=$("#toast");el.textContent=msg;el.classList.add("show");clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.classList.remove("show"),2200);}
  function nodeById(id){return state.nodes.find(n=>n.id===id);}
  function inputCount(n){return n.type==="OUTPUT"||n.type==="NOT"?1:(META[n.type]?.inputs||0);}
  function makeNode(type,x,y,extra={}){const id=uid();return {id,type,x,y,value:0,period:1000,...extra};}
  function addNode(type,x,y){checkpoint();const n=makeNode(type,x,y);state.nodes.push(n);state.selected=new Set([n.id]);state.primary=n.id;renderAll();simulate();updateInspector();return n;}
  function addAtCenter(type){const rect=viewport.getBoundingClientRect();const p=screenToWorld(rect.width/2,rect.height/2);addNode(type,p.x-72,p.y-44);}
  function screenToWorld(x,y){return {x:(x-state.pan.x)/state.zoom,y:(y-state.pan.y)/state.zoom};}
  function worldToScreen(x,y){return {x:x*state.zoom+state.pan.x,y:y*state.zoom+state.pan.y};}
  function applyTransform(){stage.style.transform=`translate(${state.pan.x}px,${state.pan.y}px) scale(${state.zoom})`;$("#zoomLabel").textContent=Math.round(state.zoom*100)+"%";}
  function renderAll(){renderNodes();renderWires();$("#emptyHint").style.display=state.nodes.length?"none":"block";updateCounts();applyTransform();}
  function gateSVG(type){
    const paths={
      AND:'<path d="M12 8 H38 A18 18 0 0 1 38 44 H12 Z"/>',
      OR:'<path d="M10 8 Q29 26 10 44 Q35 44 60 26 Q35 8 10 8 Z"/>',
      NOT:'<path d="M15 8 L55 26 L15 44 Z"/><circle cx="61" cy="26" r="4"/>',
      NAND:'<path d="M8 8 H34 A18 18 0 0 1 34 44 H8 Z"/><circle cx="57" cy="26" r="4"/>',
      NOR:'<path d="M7 8 Q25 26 7 44 Q32 44 50 26 Q32 8 7 8 Z"/><circle cx="58" cy="26" r="4"/>',
      XOR:'<path d="M16 8 Q35 26 16 44 Q41 44 64 26 Q41 8 16 8 Z"/><path d="M8 8 Q27 26 8 44" fill="none"/>',
      XNOR:'<path d="M13 8 Q32 26 13 44 Q38 44 57 26 Q38 8 13 8 Z"/><path d="M5 8 Q24 26 5 44" fill="none"/><circle cx="65" cy="26" r="4"/>'
    };
    return `<svg class="gate-svg" viewBox="0 0 78 52" aria-hidden="true">${paths[type]||""}</svg>`;
  }
  function portMarkup(n,dir,index=0){const cls=dir==="in"?"input-port":"output-port";const count=inputCount(n);const top=29+29+(index-(count-1)/2)*15;return `<button class="port ${cls}" style="top:${top}px" data-node="${n.id}" data-dir="${dir}" data-index="${index}" title="${dir==="in"?"Entrada":"Saída"} ${index+1}"></button>`;}
  function renderNodes(){
    nodesLayer.innerHTML=state.nodes.map(n=>{
      const selected=state.selected.has(n.id), isGate=GATES.includes(n.type);
      const inputs=Array.from({length:inputCount(n)},(_,i)=>portMarkup(n,"in",i)).join("");
      const output= n.type==="OUTPUT"?"":portMarkup(n,"out",0);
      let body="";
      if(n.type==="INPUT")body=`<button class="input-switch ${n.value?"":"off"}" data-action="toggle" data-id="${n.id}">${n.value}</button><span class="node-output">BIT</span>`;
      else if(n.type==="CLOCK")body=`<span class="node-value ${n.value?"one":"zero"}">${n.value}</span><span class="node-output">CLOCK</span>`;
      else if(n.type==="OUTPUT")body=`<span class="output-lamp ${n.value?"one":"zero"}"></span><span class="node-value ${n.value?"one":"zero"}">${n.value}</span>`;
      else body=gateSVG(n.type)+`<span class="node-value ${n.value===1?"one":n.value===0?"zero":""}">${n.value===null?"?":n.value}</span>`;
      const labels=isGate?`<span class="port-label in">IN</span><span class="port-label out">OUT</span>`:"";
      return `<div class="node ${selected?"selected":""} ${selected&&state.selected.size>1?"multi-selected":""} ${n.type==="INPUT"?"node-input":n.type==="OUTPUT"?"node-output":n.type==="CLOCK"?"node-clock":""}" data-id="${n.id}" style="left:${n.x}px;top:${n.y}px">
        <div class="node-head"><span class="node-title">${n.type}</span><span class="node-id">#${n.id}</span></div>
        <div class="node-body">${inputs}${body}${output}${labels}</div></div>`;
    }).join("");
    // Atualiza cores dos terminais conforme o sinal calculado.
    state.wires.forEach(w=>{const el=nodesLayer.querySelector(`.port.output-port[data-node="${w.from}"]`);if(el)el.classList.add(logicClass(nodeById(w.from)?.value));});
    state.wires.forEach(w=>{const el=nodesLayer.querySelector(`.port.input-port[data-node="${w.to}"][data-index="${w.input}"]`);if(el)el.classList.add(logicClass(nodeById(w.from)?.value));});
  }
  function logicClass(v){return v===1?"logic-1":v===0?"logic-0":"";}
  function portPoint(id,dir,index=0){const n=nodeById(id);if(!n)return{x:0,y:0};const count=inputCount(n);const y=n.y+29+29;return dir==="out"?{x:n.x+144,y}:{x:n.x,y:y+(index-(count-1)/2)*15};}
  function renderWires(){
    wireLayer.innerHTML=state.wires.map((w,i)=>{
      const a=portPoint(w.from,"out"),b=portPoint(w.to,"in",w.input),mid=(a.x+b.x)/2;
      const d=`M ${a.x} ${a.y} C ${mid} ${a.y}, ${mid} ${b.y}, ${b.x} ${b.y}`;
      const val=nodeById(w.from)?.value;
      return `<path class="wire ${logicClass(val)}" data-wire="${i}" d="${d}"><title>Conexão ${i+1} — clique para remover</title></path>`;
    }).join("");
  }
  function updateCounts(){$("#componentCount").textContent=`${state.nodes.length} componentes · ${state.wires.length} conexões`;}
  function incoming(n,index){return state.wires.find(w=>w.to===n.id&&w.input===index);}
  function evaluate(type,vals){
    if(vals.some(v=>v===null||v===undefined))return null;
    const [a,b]=vals;
    switch(type){case"AND":return vals.every(v=>v===1)?1:0;case"OR":return vals.some(v=>v===1)?1:0;case"NOT":return a?0:1;case"NAND":return vals.every(v=>v===1)?0:1;case"NOR":return vals.some(v=>v===1)?0:1;case"XOR":return a!==b?1:0;case"XNOR":return a===b?1:0;default:return null;}
  }
  function simulate(){
    // Avaliação iterativa em ordem topológica. Circuitos cíclicos são recusados na criação da conexão.
    const indegree=new Map(state.nodes.map(n=>[n.id,0])), adjacency=new Map(state.nodes.map(n=>[n.id,[]]));
    state.wires.forEach(w=>{indegree.set(w.to,(indegree.get(w.to)||0)+1);adjacency.get(w.from)?.push(w.to);});
    const queue=state.nodes.filter(n=>indegree.get(n.id)===0).map(n=>n.id), order=[];
    while(queue.length){const id=queue.shift();order.push(id);(adjacency.get(id)||[]).forEach(to=>{indegree.set(to,indegree.get(to)-1);if(indegree.get(to)===0)queue.push(to);});}
    const cyclic=order.length!==state.nodes.length;
    for(const n of state.nodes){
      if(n.type==="INPUT"||n.type==="CLOCK")continue;
      n.value=null;
    }
    for(const id of order){
      const n=nodeById(id);if(!n)continue;
      if(GATES.includes(n.type)){
        const vals=Array.from({length:inputCount(n)},(_,i)=>{const w=incoming(n,i);return w?nodeById(w.from)?.value??null:null;});
        n.value=evaluate(n.type,vals);
      }else if(n.type==="OUTPUT"){const w=incoming(n,0);n.value=w?(nodeById(w.from)?.value??null):null;}
    }
    renderNodes();renderWires();updateCounts();
    $("#statusText").textContent=cyclic?"Erro: circuito contém ciclo lógico.":`Simulação atualizada · ${state.nodes.length} componentes processados.`;
    return !cyclic;
  }
  function wouldCreateCycle(from,to){
    if(from===to)return true;
    const graph=new Map(state.nodes.map(n=>[n.id,[]]));state.wires.forEach(w=>graph.get(w.from)?.push(w.to));
    const stack=[to],seen=new Set();
    while(stack.length){const id=stack.pop();if(id===from)return true;if(seen.has(id))continue;seen.add(id);(graph.get(id)||[]).forEach(x=>stack.push(x));}
    return false;
  }
  function connect(from,to,input){
    const src=nodeById(from),dst=nodeById(to);
    if(!src||!dst||src.type==="OUTPUT"||!GATES.includes(dst.type)&&dst.type!=="OUTPUT"){toast("Terminal inválido.");return false;}
    if(from===to||wouldCreateCycle(from,to)){toast("Conexão circular não permitida.");return false;}
    if(input<0||input>= (dst.type==="OUTPUT"?1:inputCount(dst))){toast("Entrada inválida.");return false;}
    if(state.wires.some(w=>w.to===to&&w.input===input)){toast("Esta entrada já está conectada. Remova o fio atual primeiro.");return false;}
    checkpoint();state.wires.push({from,to,input});simulate();renderWires();updateInspector();toast("Conexão criada.");return true;
  }
  function updateInspector(){
    const n=nodeById(state.primary);$("#selectedLabel").textContent=n?`${n.type} · #${n.id}`:"NENHUM SELECIONADO";
    if(!n){inspector.innerHTML=`<div class="inspector-empty"><div class="empty-target">◎</div><b>Nenhum componente selecionado</b><p>Selecione uma porta ou um terminal no circuito para ver detalhes e editar suas propriedades.</p></div>`;truthContent.textContent="Selecione uma porta lógica para visualizar sua tabela-verdade.";return;}
    let html=`<div class="prop-section"><h3>Componente</h3><div class="prop-row"><span>Tipo</span><b class="prop-value">${n.type}</b></div><div class="prop-row"><span>Identificador</span><b class="prop-value">#${n.id}</b></div><div class="prop-row"><span>Posição X / Y</span><b class="prop-value">${Math.round(n.x)} / ${Math.round(n.y)}</b></div><div class="prop-row"><span>Estado atual</span><b class="prop-value">${n.value===null?"—":n.value}</b></div></div>`;
    if(n.type==="INPUT")html+=`<div class="prop-section"><h3>Configuração</h3><div class="prop-row"><span>Nível lógico</span><button id="propToggle">${n.value?"1 · ALTO":"0 · BAIXO"}</button></div></div>`;
    if(n.type==="CLOCK")html+=`<div class="prop-section"><h3>Clock</h3><div class="prop-row"><label for="clockPeriod">Período (ms)</label><input id="clockPeriod" type="number" min="100" max="10000" step="100" value="${n.period}"></div><div class="prop-row"><span>Controle</span><button id="clockToggle">${n.running?"Pausar":"Iniciar"}</button></div></div>`;
    if(n.type==="OUTPUT")html+=`<div class="prop-section"><h3>Leitura</h3><div class="prop-row"><span>Entrada conectada</span><b class="prop-value">${incoming(n,0)?"Sim":"Não"}</b></div></div>`;
    html+=`<div class="prop-section"><h3>Ações</h3><div class="prop-row"><button id="duplicateBtn">Duplicar</button><button id="deleteBtn" class="danger-btn">Excluir</button></div></div>`;
    inspector.innerHTML=html;
    $("#propToggle")?.addEventListener("click",()=>toggleInput(n.id));
    $("#duplicateBtn").addEventListener("click",()=>duplicateSelected());
    $("#deleteBtn").addEventListener("click",()=>deleteSelected());
    $("#clockPeriod")?.addEventListener("change",e=>{checkpoint();n.period=Math.max(100,Math.min(10000,Number(e.target.value)||1000));});
    $("#clockToggle")?.addEventListener("click",()=>toggleClock(n));
    renderTruth(n);
  }
  function renderTruth(n){
    if(!GATES.includes(n.type)){truthContent.textContent="A tabela-verdade está disponível para portas lógicas.";return;}
    const count=inputCount(n), rows=[];
    for(let i=0;i<2**count;i++){const vals=Array.from({length:count},(_,j)=>(i>>(count-1-j))&1);rows.push({vals,out:evaluate(n.type,vals)});}
    const current=Array.from({length:count},(_,i)=>{const w=incoming(n,i);return w?nodeById(w.from)?.value??null:null;});
    const result=evaluate(n.type,current);
    const head=Array.from({length:count},(_,i)=>`<th>${String.fromCharCode(65+i)}</th>`).join("");
    const body=rows.map(r=>`<tr class="${r.vals.every((v,i)=>current[i]===v)?"current-row":""}">${r.vals.map(v=>`<td>${v}</td>`).join("")}<td>${r.out}</td></tr>`).join("");
    truthContent.innerHTML=`<div class="truth-expression">Expressão: <b>${META[n.type].expr}</b></div><div style="font-size:10px;color:#8594a9;margin-bottom:5px">${count} entrada(s) · saída atual: <b>${result===null?"—":result}</b></div><table><thead><tr>${head}<th>Y</th></tr></thead><tbody>${body}</tbody></table>`;
  }
  function toggleInput(id){const n=nodeById(id);if(!n||n.type!=="INPUT")return;checkpoint();n.value=n.value?0:1;simulate();updateInspector();}
  function toggleClock(n){n.running=!n.running;if(n.running){n.value=0;n._timer=setInterval(()=>{n.value=n.value?0:1;simulate();if(state.primary===n.id)updateInspector();},n.period);}else{clearInterval(n._timer);n._timer=null;}updateInspector();}
  function stopClocks(){state.nodes.filter(n=>n.type==="CLOCK").forEach(n=>{clearInterval(n._timer);n._timer=null;n.running=false;});}
  function selectNode(id,additive=false){if(!additive)state.selected.clear();if(additive&&state.selected.has(id))state.selected.delete(id);else state.selected.add(id);state.primary=state.selected.has(id)?id:(state.selected.values().next().value||null);renderNodes();updateInspector();}
  function deleteSelected(){if(!state.selected.size)return;checkpoint();const ids=new Set(state.selected);state.nodes.filter(n=>ids.has(n.id)).forEach(n=>{if(n._timer)clearInterval(n._timer);});state.nodes=state.nodes.filter(n=>!ids.has(n.id));state.wires=state.wires.filter(w=>!ids.has(w.from)&&!ids.has(w.to));state.selected.clear();state.primary=null;renderAll();simulate();updateInspector();}
  function duplicateSelected(){const originals=state.nodes.filter(n=>state.selected.has(n.id));if(!originals.length)return;checkpoint();const map=new Map();const copies=originals.map(n=>{const c=makeNode(n.type,n.x+35,n.y+35,{value:n.value,period:n.period});map.set(n.id,c.id);return c;});state.nodes.push(...copies);const selectedIds=new Set(copies.map(n=>n.id));state.selected=selectedIds;state.primary=copies[0].id;renderAll();simulate();updateInspector();}
  function removeWire(index){if(index<0||index>=state.wires.length)return;checkpoint();state.wires.splice(index,1);simulate();updateInspector();toast("Conexão removida.");}
  function startWire(port,e){
    const dir=port.dataset.dir;if(dir!=="out")return;
    const id=Number(port.dataset.node);const n=nodeById(id);if(!n||n.type==="OUTPUT")return;
    e.stopPropagation();e.preventDefault();interaction={kind:"wire",from:id,pointerId:e.pointerId};
    const p=screenToWorld(e.clientX-viewport.getBoundingClientRect().left,e.clientY-viewport.getBoundingClientRect().top);
    const a=portPoint(id,"out");draftWire.style.display="block";draftWire.setAttribute("d",`M ${a.x} ${a.y} L ${p.x} ${p.y}`);
    viewport.setPointerCapture(e.pointerId);
  }
  function onPointerMove(e){
    if(!interaction)return;
    if(interaction.kind==="wire"){
      const r=viewport.getBoundingClientRect(),p=screenToWorld(e.clientX-r.left,e.clientY-r.top),a=portPoint(interaction.from,"out");
      draftWire.setAttribute("d",`M ${a.x} ${a.y} L ${p.x} ${p.y}`);return;
    }
    if(interaction.kind==="move"){
      interaction.moved=true;
      const r=viewport.getBoundingClientRect(),p=screenToWorld(e.clientX-r.left,e.clientY-r.top),dx=p.x-interaction.start.x,dy=p.y-interaction.start.y;
      interaction.ids.forEach(id=>{const n=nodeById(id),o=interaction.origins.get(id);if(n){n.x=o.x+dx;n.y=o.y+dy;const el=nodesLayer.querySelector(`.node[data-id="${id}"]`);if(el){el.style.left=n.x+"px";el.style.top=n.y+"px";}}});
      renderWires();updateInspector();return;
    }
    if(interaction.kind==="pan"){state.pan.x=interaction.pan.x+(e.clientX-interaction.start.x);state.pan.y=interaction.pan.y+(e.clientY-interaction.start.y);applyTransform();}
  }
  function onPointerUp(e){
    if(!interaction)return;
    if(interaction.kind==="wire"){
      draftWire.style.display="none";const el=document.elementFromPoint(e.clientX,e.clientY)?.closest(".port.input-port");
      if(el)connect(interaction.from,Number(el.dataset.node),Number(el.dataset.index));
    }else if(interaction.kind==="move"){if(interaction.moved){if(state.grid)interaction.ids.forEach(id=>{const n=nodeById(id);if(n){n.x=Math.round(n.x/22)*22;n.y=Math.round(n.y/22)*22;}});history.undo.push(interaction.before);if(history.undo.length>history.limit)history.undo.shift();history.redo=[];updateHistoryButtons();renderAll();simulate();updateInspector();}}
    interaction=null;
  }
  nodesLayer.addEventListener("pointerdown",e=>{
    const port=e.target.closest(".port");if(port){startWire(port,e);return;}
    const toggle=e.target.closest("[data-action=toggle]");if(toggle){toggleInput(Number(toggle.dataset.id));e.stopPropagation();return;}
    const nodeEl=e.target.closest(".node");if(!nodeEl)return;
    const id=Number(nodeEl.dataset.id);selectNode(id,e.shiftKey);
    if(e.button!==0)return;
    const r=viewport.getBoundingClientRect(),p=screenToWorld(e.clientX-r.left,e.clientY-r.top);
    const ids=state.selected.has(id)?[...state.selected]:[id];
    interaction={kind:"move",ids,start:p,origins:new Map(ids.map(i=>{const n=nodeById(i);return[i,{x:n.x,y:n.y}]})),before:snap(),moved:false};
    viewport.setPointerCapture(e.pointerId);
  });
  nodesLayer.addEventListener("pointermove",e=>{if(interaction?.kind==="move")interaction.moved=true;});
  viewport.addEventListener("pointermove",onPointerMove);viewport.addEventListener("pointerup",onPointerUp);viewport.addEventListener("pointercancel",onPointerUp);
  wireLayer.addEventListener("click",e=>{const p=e.target.closest("[data-wire]");if(p)removeWire(Number(p.dataset.wire));});
  viewport.addEventListener("pointerdown",e=>{
    if(e.target.closest(".node")||e.target.closest(".port"))return;
    if(e.button===1||spaceDown){interaction={kind:"pan",start:{x:e.clientX,y:e.clientY},pan:{...state.pan}};viewport.setPointerCapture(e.pointerId);e.preventDefault();}
    else if(e.button===0){state.selected.clear();state.primary=null;renderNodes();updateInspector();}
  });
  $$(".component-item").forEach(item=>{
    item.addEventListener("dragstart",e=>{e.dataTransfer.setData("text/plain",item.dataset.type);e.dataTransfer.effectAllowed="copy";});
    item.addEventListener("click",()=>addAtCenter(item.dataset.type));
  });
  viewport.addEventListener("dragover",e=>{e.preventDefault();e.dataTransfer.dropEffect="copy";});
  viewport.addEventListener("drop",e=>{e.preventDefault();const type=e.dataTransfer.getData("text/plain");if(![...GATES,...INPUT_TYPES,"OUTPUT"].includes(type))return;const r=viewport.getBoundingClientRect(),p=screenToWorld(e.clientX-r.left,e.clientY-r.top);addNode(type,p.x-72,p.y-44);});
  function zoomAt(next,cx,cy){const old=state.zoom;next=Math.max(.35,Math.min(2.2,next));const wx=(cx-state.pan.x)/old,wy=(cy-state.pan.y)/old;state.zoom=next;state.pan.x=cx-wx*next;state.pan.y=cy-wy*next;applyTransform();}
  viewport.addEventListener("wheel",e=>{e.preventDefault();const r=viewport.getBoundingClientRect();zoomAt(state.zoom*(e.deltaY<0?1.1:.9),e.clientX-r.left,e.clientY-r.top);},{passive:false});
  $("#zoomIn").addEventListener("click",()=>zoomAt(state.zoom*1.15,viewport.clientWidth/2,viewport.clientHeight/2));
  $("#zoomOut").addEventListener("click",()=>zoomAt(state.zoom/1.15,viewport.clientWidth/2,viewport.clientHeight/2));
  $("#fitBtn").addEventListener("click",()=>{if(!state.nodes.length){state.zoom=1;state.pan={x:40,y:40};applyTransform();return;}const minX=Math.min(...state.nodes.map(n=>n.x)),minY=Math.min(...state.nodes.map(n=>n.y)),maxX=Math.max(...state.nodes.map(n=>n.x+144)),maxY=Math.max(...state.nodes.map(n=>n.y+88));const z=Math.min(1.5,(viewport.clientWidth-100)/(maxX-minX+80),(viewport.clientHeight-100)/(maxY-minY+80));state.zoom=Math.max(.35,z);state.pan={x:(viewport.clientWidth-(maxX-minX)*state.zoom)/2-minX*state.zoom,y:(viewport.clientHeight-(maxY-minY)*state.zoom)/2-minY*state.zoom};applyTransform();});
  $("#gridToggle").addEventListener("change",e=>{state.grid=e.target.checked;viewport.classList.toggle("no-grid",!state.grid);});
  $("#runBtn").addEventListener("click",()=>{simulate();updateInspector();toast("Simulação atualizada.");});
  $("#clearBtn").addEventListener("click",()=>{if(!state.nodes.length)return;if(!confirm("Limpar todo o circuito?"))return;checkpoint();stopClocks();state.nodes=[];state.wires=[];state.selected.clear();state.primary=null;renderAll();updateInspector();toast("Circuito limpo.");});
  $("#undoBtn").addEventListener("click",undo);$("#redoBtn").addEventListener("click",redo);
  $("#saveBtn").addEventListener("click",()=>{const data={format:"logic-simulator",version:1,nodes:state.nodes.map(({id,type,x,y,value,period})=>({id,type,x,y,value,period})),wires:state.wires};downloadBlob(new Blob([JSON.stringify(data,null,2)],{type:"application/json"}),"circuito-logic-simulator.json");toast("Projeto JSON salvo.");});
  $("#loadBtn").addEventListener("click",()=>$("#fileInput").click());
  $("#fileInput").addEventListener("change",async e=>{const file=e.target.files[0];if(!file)return;try{const d=JSON.parse(await file.text());if(!Array.isArray(d.nodes)||!Array.isArray(d.wires))throw new Error("Formato inválido");const ids=new Set(d.nodes.map(n=>n.id));if(d.nodes.some(n=>!["INPUT","OUTPUT","CLOCK",...GATES].includes(n.type))||d.wires.some(w=>!ids.has(w.from)||!ids.has(w.to)))throw new Error("Componentes ou conexões inválidos");checkpoint();stopClocks();state.nodes=d.nodes.map(n=>({...n,_timer:null,running:false}));state.wires=d.wires;state.nextId=Math.max(0,...state.nodes.map(n=>n.id))+1;state.selected.clear();state.primary=null;renderAll();simulate();updateInspector();toast("Projeto carregado.");}catch(err){alert("Não foi possível carregar o arquivo: "+err.message);}e.target.value="";});
  function downloadBlob(blob,name){const a=document.createElement("a"),url=URL.createObjectURL(blob);a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  $("#pngBtn").addEventListener("click",()=>{
    const bounds=state.nodes.length?{minX:Math.min(...state.nodes.map(n=>n.x))-30,minY:Math.min(...state.nodes.map(n=>n.y))-30,maxX:Math.max(...state.nodes.map(n=>n.x+144))+30,maxY:Math.max(...state.nodes.map(n=>n.y+88))+30}:{minX:0,minY:0,maxX:800,maxY:500};
    const w=bounds.maxX-bounds.minX,h=bounds.maxY-bounds.minY;
    const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="${w*2}" height="${h*2}" viewBox="${bounds.minX} ${bounds.minY} ${w} ${h}"><rect x="${bounds.minX}" y="${bounds.minY}" width="${w}" height="${h}" fill="#111821"/>${state.wires.map(wr=>{const a=portPoint(wr.from,"out"),b=portPoint(wr.to,"in",wr.input),m=(a.x+b.x)/2,v=nodeById(wr.from)?.value,c=v===1?"#35d39a":v===0?"#ff647c":"#7d899b";return `<path d="M${a.x} ${a.y} C${m} ${a.y} ${m} ${b.y} ${b.x} ${b.y}" fill="none" stroke="${c}" stroke-width="3"/>`;}).join("")}${state.nodes.map(n=>`<g transform="translate(${n.x},${n.y})"><rect width="144" height="88" rx="10" fill="#222c3a" stroke="#657895"/><rect width="144" height="29" rx="9" fill="#293547"/><text x="10" y="19" fill="#e8edf5" font-size="11" font-weight="bold">${n.type} #${n.id}</text><text x="72" y="65" fill="${n.value===1?"#35d39a":n.value===0?"#ff647c":"#b7c5dc"}" font-size="20" text-anchor="middle">${n.value??"?"}</text></g>`).join("")}</svg>`;
    const blob=new Blob([svg],{type:"image/svg+xml"}),url=URL.createObjectURL(blob),img=new Image();
    img.onload=()=>{const canvas=document.createElement("canvas");canvas.width=w*2;canvas.height=h*2;const ctx=canvas.getContext("2d");ctx.drawImage(img,0,0);canvas.toBlob(b=>downloadBlob(b,"circuito.png"),"image/png");URL.revokeObjectURL(url);};img.onerror=()=>{URL.revokeObjectURL(url);toast("Falha ao exportar imagem.");};img.src=url;
  });
  document.addEventListener("keydown",e=>{
    if(["INPUT","TEXTAREA"].includes(document.activeElement.tagName))return;
    if(e.code==="Space"){spaceDown=true;e.preventDefault();}
    if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==="z"){e.preventDefault();e.shiftKey?redo():undo();}
    if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==="y"){e.preventDefault();redo();}
    if(e.key==="Delete"||e.key==="Backspace"){e.preventDefault();deleteSelected();}
    if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==="d"){e.preventDefault();duplicateSelected();}
    if(e.key==="Escape"){draftWire.style.display="none";interaction=null;state.selected.clear();state.primary=null;renderNodes();updateInspector();}
  });
  document.addEventListener("keyup",e=>{if(e.code==="Space")spaceDown=false;});
  // Encaixe visual opcional: posições são livres; com grade ativa, mover usa passo de 22 px.
  const originalPointerMove=onPointerMove;
  // Clock é opcional e permanece parado até o usuário iniciá-lo no inspetor.
  state.pan={x:40,y:40};applyTransform();renderAll();updateInspector();updateHistoryButtons();
})();