const fs = require('fs');
let code = fs.readFileSync('src/hooks/useTerminalLink.ts', 'utf8');

const search = `        _core?: {
            _linkProviderService?: {
                linkProviders?: Map<number, TerminalLinkProvider>;
            };
        };`;

const replace = `        _core?: {
            _linkProviderService?: {
                linkProviders?: Map<number, TerminalLinkProvider>;
            };
            coreService?: {
                triggerDataEvent?: (data: string, wasUserInput?: boolean) => void;
            };
        };`;

code = code.replace(search, replace);
fs.writeFileSync('src/hooks/useTerminalLink.ts', code);
