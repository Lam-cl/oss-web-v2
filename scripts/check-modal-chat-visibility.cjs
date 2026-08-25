const fs=require('fs');const assert=require('assert');
const chrome=fs.readFileSync('src/components/layout/RouteChrome.tsx','utf8');
assert(chrome.includes("document.querySelector('[aria-modal=\"true\"]')"),'chat visibility must detect every open modal');
assert(chrome.includes("wrapper.style.setProperty('display', 'none', 'important')"),'open modal must hide a light-DOM ancestor that shadow :host rules cannot override');
assert(chrome.includes("wrapper.style.setProperty('display', 'contents')"),'closing the last modal must restore Balam widget without adding layout');
assert(chrome.includes("wrapper.appendChild(host)"),'Balam host must stay inside the visibility wrapper');
assert(chrome.includes('hostObserver=new MutationObserver(()=>install())'),'modal detection and Balam theme installation must react to portal-mounted DOM changes');
console.log('Global modal chat visibility check passed');
