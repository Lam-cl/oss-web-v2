const assert = require('node:assert/strict');
const { callable } = require('./test-source-helpers.cjs');
module.exports = function checkBalam(pathname = '/') {
  const file = 'src/components/layout/RouteChrome.tsx';
  class Node {
    constructor(id = '') { this.id = id; this.children = []; this.dataset = {}; this.values = {}; this.style = { setProperty: (k,v) => this.values[k]=v, removeProperty: k => delete this.values[k] }; }
    setAttribute(k,v) { this[k] = v; }
    appendChild(node) { if(node.parentElement)node.parentElement.children=node.parentElement.children.filter(n=>n!==node); this.children.push(node);node.parentElement=this;node.parentNode=this; }
    insertBefore(node) { this.appendChild(node); }
    querySelector(selector) { return selector === '.Assistant-icon' ? this.icon : this.children.find(n=>n.dataset.tonewowBalamLauncher==='true') || null; }
  }
  const body = new Node('body');
  const makeHost = () => {
    const host = new Node('Assistant-Shadow-Host'), toggle = new Node('Assistant-Toggle'), main = new Node('Assistant-Main');
    toggle.icon = new Node('icon');
    host.shadowRoot = { getElementById: id => id === toggle.id ? toggle : id === main.id ? main : null };
    body.appendChild(host);return {host,toggle,main};
  };
  let current = makeHost(), modal = false;
  const recursive = (node,id) => node.id===id?node:node.children.map(n=>recursive(n,id)).find(Boolean);
  const document = { body, createElement:()=>new Node(), getElementById:id=>recursive(body,id), querySelector:()=>modal ? {} : null };
  const observers = [];
  class Observer {
    constructor(callback) {this.callback=callback;observers.push(this);}
    observe(target) {this.target=target;this.active=true;}
    disconnect() {this.active=false;}
  }
  const install = callable(file,'installToneWowLauncher',{document,window:{location:{origin:'https://shop.tonewow.com'}},BALAM_LAUNCHER_SELECTOR:'img[data-tonewow-balam-launcher]'});
  let cleanup;
  const useTheme=callable(file,'useBalamToneWowTheme',{document,MutationObserver:Observer,CHAT_PROVIDER:'balam',installToneWowLauncher:install,useEffect:effect=>{cleanup=effect();}});
  useTheme(pathname);
  const launcher = current.toggle.children[0];
  assert.equal(launcher.src,'https://shop.tonewow.com/images/balam-tonewow-chat.svg');
  assert.equal(current.toggle.icon.values.display,'none');
  assert.equal(current.host.values.visibility,'visible');
  install(current.host.shadowRoot);assert.equal(current.toggle.children.length,1,'Launcher is idempotent');
  assert.equal(current.main.values.bottom, pathname.startsWith('/cart')||pathname.startsWith('/checkout')?'calc(82px + env(safe-area-inset-bottom))':'max(12px, 2%)');
  const bodyObserver=observers.find(o=>o.target===body);
  const wrapper=document.getElementById('tonewow-chat-visibility-wrapper');
  modal=true;bodyObserver.callback();assert.equal(wrapper.values.display,'none');
  modal=false;bodyObserver.callback();assert.equal(wrapper.values.display,pathname.startsWith('/checkout')?'none':'contents');
  current.toggle.children=[];
  observers.find(o=>o.active&&o.target===current.host.shadowRoot).callback();
  assert.equal(current.toggle.children.length,1,'Shadow rerender restores the custom launcher');
  current.host.parentElement.children=[];
  current=makeHost();bodyObserver.callback();
  assert.equal(current.toggle.children.length,1,'Replacement provider host is branded');
  const replacementObserver=observers.find(o=>o.active&&o.target===current.host.shadowRoot);
  assert(replacementObserver,'Observer must follow the replacement shadow root');
  current.toggle.children=[];replacementObserver.callback();assert.equal(current.toggle.children.length,1);
  cleanup();assert(observers.every(o=>!o.active),'All observers are disconnected on cleanup');
};
