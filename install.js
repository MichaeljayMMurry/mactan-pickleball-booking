const install = document.querySelector('#install-app');
let pending;

window.addEventListener('beforeinstallprompt', event => {
  event.preventDefault();
  pending = event;
  install.hidden = false;
});
window.addEventListener('appinstalled', () => {
  pending = null;
  install.hidden = true;
});
install.addEventListener('click', async () => {
  const prompt = pending;
  if (!prompt) return;
  pending = null;
  install.hidden = true;
  try {
    await prompt.prompt();
  } catch (error) {
    console.warn('Unable to show the install prompt.', error);
  }
});

if ('serviceWorker' in navigator && window.isSecureContext) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/service-worker.js').catch(error => console.warn('Unable to register offline support.', error));
  }, { once: true });
}
