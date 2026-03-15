const { app } = require('electron');
const os = require('os');
const path = require('path');

let mainWindow = null;
let mdnsBrowser = null;
let httpServer = null;
let gitSshProcess = null;
let sshPort = 0;

// Path to the Go SSH binary.
// In dev: built locally at main/git-server/gitsync-ssh
// In production: packaged as extraResources outside the asar
const gitSshBin = app.isPackaged
  ? path.join(process.resourcesPath, 'gitsync-ssh')
  : path.join(__dirname, '..', 'git-server', 'gitsync-ssh');

const CONFIG_DIR = path.join(os.homedir(), '.config', 'gitsync');
const HOST_KEY_PATH = path.join(CONFIG_DIR, 'ssh_host_key');

// Track online peers (peerId -> { host, httpPort, sshPort, lastSeen })
const onlinePeers = new Map();

function getMainWindow() {
  return mainWindow;
}
function setMainWindow(w) {
  mainWindow = w;
}

function getMdnsBrowser() {
  return mdnsBrowser;
}
function setMdnsBrowser(b) {
  mdnsBrowser = b;
}

function getHttpServer() {
  return httpServer;
}
function setHttpServer(s) {
  httpServer = s;
}

function getGitSshProcess() {
  return gitSshProcess;
}
function setGitSshProcess(p) {
  gitSshProcess = p;
}

function getSshPort() {
  return sshPort;
}
function setSshPort(p) {
  sshPort = p;
}

function getGitSshBin() {
  return gitSshBin;
}
function getConfigDir() {
  return CONFIG_DIR;
}
function getHostKeyPath() {
  return HOST_KEY_PATH;
}
function getOnlinePeers() {
  return onlinePeers;
}

module.exports = {
  getMainWindow,
  setMainWindow,
  getMdnsBrowser,
  setMdnsBrowser,
  getHttpServer,
  setHttpServer,
  getGitSshProcess,
  setGitSshProcess,
  getSshPort,
  setSshPort,
  getGitSshBin,
  getConfigDir,
  getHostKeyPath,
  getOnlinePeers,
};
