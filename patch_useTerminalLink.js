const fs = require('fs');
const content = fs.readFileSync('src/hooks/useTerminalLink.ts', 'utf8');
const search = `
        paste: (text: string) => void;
        scrollToBottom?: () => void;
        buffer?: {
`;
const replace = `
        paste: (text: string) => void;
        scrollToBottom?: () => void;
        attachCustomKeyEventHandler?: (customKeyEventHandler: (event: KeyboardEvent) => boolean) => void;
        customKeyEventHandler?: (event: KeyboardEvent) => boolean;
        buffer?: {
`;
fs.writeFileSync('src/hooks/useTerminalLink.ts', content.replace(search, replace));
