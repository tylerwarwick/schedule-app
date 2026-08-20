// Local dev default: empty string means "same origin as this page"
// (works when server.js serves this file itself).
// On Render, the coursemap-web static site's build step overwrites this
// file with the deployed API URL — see render.yaml.
window.API_BASE = "";
