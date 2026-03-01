import os from 'os';
import path from 'path';

// Get cross-platform app data directory
export function getAppDataDir(): string {
  const platform = process.platform;
  const homeDir = os.homedir();

  if (platform === 'win32') {
    // Windows: %APPDATA%\trident
    return path.join(process.env.APPDATA || path.join(homeDir, 'AppData', 'Roaming'), 'trident');
  } else if (platform === 'darwin') {
    // macOS: ~/Library/Application Support/trident
    return path.join(homeDir, 'Library', 'Application Support', 'trident');
  } else {
    // Linux/others: ~/.config/trident
    return path.join(process.env.XDG_CONFIG_HOME || path.join(homeDir, '.config'), 'trident');
  }
}
