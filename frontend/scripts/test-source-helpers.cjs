const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const ts = require('typescript');

function compile(relative, injected = {}, cache = new Map()) {
  const file = path.resolve(relative);
  if (cache.has(file)) return cache.get(file).exports;
  const module = { exports: {} };
  cache.set(file, module);
  const nativeRequire = createRequire(file);
  const localRequire = id => {
    if (Object.hasOwn(injected, id)) return injected[id];
    if (id.startsWith('.') || id.startsWith('@/')) {
      const target = id.startsWith('@/') ? path.resolve('src', id.slice(2)) : path.resolve(path.dirname(file), id);
      for (const candidate of [target, target + '.ts', target + '.tsx', path.join(target, 'index.ts')]) {
        if (fs.existsSync(candidate) && fs.statSync(candidate).isFile() && /\.tsx?$/.test(candidate)) return compile(candidate, injected, cache);
      }
    }
    return nativeRequire(id);
  };
  const output = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, esModuleInterop: true },
  }).outputText;
  new Function('exports', 'require', 'module', '__filename', '__dirname', output)(module.exports, localRequire, module, file, path.dirname(file));
  return module.exports;
}

function parse(file) { return ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX); }
function find(tree, predicate) {
  const result = [];
  const visit = node => { if (predicate(node)) result.push(node); ts.forEachChild(node, visit); };
  visit(tree); return result;
}
function callable(file, name, scope) {
  const tree = parse(file);
  const node = find(tree, n => ts.isFunctionDeclaration(n) && n.name?.text === name)[0];
  if (!node) throw new Error(`Function ${name} missing`);
  const code = ts.transpileModule(node.getText(tree), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  return new Function(...Object.keys(scope), code + `;return ${name};`)(...Object.values(scope));
}
function text(node) { return find(node, ts.isJsxText).map(n => n.text.trim()).filter(Boolean).join(' '); }
function elements(tree, tag) { return find(tree, n => ts.isJsxElement(n) && n.openingElement.tagName.getText() === tag); }
function attribute(node, name, tree) {
  const opening = ts.isJsxElement(node) ? node.openingElement : node;
  const attr = opening.attributes.properties.find(n => ts.isJsxAttribute(n) && n.name.getText(tree) === name);
  return attr?.initializer;
}
module.exports = { compile, parse, find, callable, text, elements, attribute, ts };
