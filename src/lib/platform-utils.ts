import os from 'os';
import path from 'path';

export function getAppDataDir(): string {
  const homeDir = os.homedir();

  if (process.platform === 'darwin') {
    return path.join(homeDir, 'Library', 'Application Support', 'trident');
  }

  // Linux: ~/.config/trident
  return path.join(process.env.XDG_CONFIG_HOME || path.join(homeDir, '.config'), 'trident');
}
