import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

window.__TEST_MODE = true

document.body.innerHTML = `
  <nav id="nav-list"></nav>
  <form id="config-form"></form>
  <div id="status-bar"></div>
  <footer></footer>
  <button id="btn-save-apply"></button>
  <mark id="server-changed" hidden>
    <span id="notif-text"></span>
    <button id="notif-load" hidden></button>
    <button id="notif-keep" hidden></button>
    <button id="notif-keep-local" hidden></button>
    <button id="notif-accept-server" hidden></button>
  </mark>
`

window.fetch = () => Promise.resolve({ ok: true, json: () => Promise.resolve({}) })

window.WebSocket = function (url) {
  this.url = url;
  this.readyState = 0;
  var self = this;
  setTimeout(function () {
    self.readyState = 1;
    if (self.onopen) self.onopen();
  }, 0);
};
window.WebSocket.prototype.send = function (data) {
  if (window.__test.onWSSend) window.__test.onWSSend(data);
};
window.WebSocket.prototype.close = function () {
  this.readyState = 3;
  if (this.onclose) this.onclose();
};

const code = readFileSync(resolve(__dirname, '../app.js'), 'utf-8')
;(0, eval)(code)
