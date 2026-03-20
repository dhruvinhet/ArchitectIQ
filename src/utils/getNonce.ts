/**
 * Generates a cryptographically random nonce string for use in Content Security Policy.
 * This nonce must be added to every <style> and <script> tag in the webview HTML.
 * Without a valid nonce, VS Code's webview sandbox blocks all inline scripts → blank UI.
 */
export function getNonce(): string {
  let text = '';
  const possible =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}
