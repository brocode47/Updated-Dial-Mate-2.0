import os
import glob
import re
import shutil

def parse_file(filepath):
    with open(filepath, 'r', encoding='utf-8') as f:
        code = f.read()

    # 1. Remove import { html } from './jsx.js';
    code = re.sub(r"import\s*\{\s*html\s*\}\s*from\s*['\"]\.\.?/(?:\.\./)*jsx\.js['\"];?\s*", "", code)

    # 2. Replace <${Component} ...> -> <Component ...>
    code = re.sub(r"<\$\{([^}]+)\}", r"<\1", code)
    # Replace </${Component}> -> </Component>
    code = re.sub(r"</\$\{([^}]+)\}>", r"</\1>", code)

    # 3. Handle dynamic attributes attr=${...} -> attr={...}
    # This also matches spread attributes: ...${props} -> {...props}
    while True:
        match = re.search(r"(?:=|\.\.\.)\$\{", code)
        if not match:
            break
        
        start = match.start()
        is_spread = code[start:start+3] == '...'
        
        if is_spread:
            start_brace = start + 4
        else:
            start_brace = start + 2
            
        braces = 0
        end = -1
        for i in range(start_brace, len(code)):
            if code[i] == '{':
                braces += 1
            elif code[i] == '}':
                braces -= 1
                if braces == 0:
                    end = i
                    break
        
        if end != -1:
            if is_spread:
                code = code[:start] + '{...' + code[start_brace+1:end] + '}' + code[end+1:]
            else:
                code = code[:start] + '={' + code[start_brace+1:end] + '}' + code[end+1:]
        else:
            break

    # 4. Remove html` (only the prefix, leave the backticks and we manually remove them if we want, or remove html`)
    code = code.replace("html`", "")
    
    # 5. Fix local imports .js -> .jsx (since we will rename them)
    # Just the ones we know we are renaming (components, pages, main)
    # Actually, we can just remove .js from local imports.
    code = re.sub(r"from\s*['\"](\.[^'\"]*)\.js['\"]", r"from '\1'", code)

    new_path = filepath[:-3] + '.jsx'
    with open(new_path, 'w', encoding='utf-8') as f:
        f.write(code)
    
    if filepath != new_path:
        os.remove(filepath)

if __name__ == '__main__':
    # Ignore store.js, utils.js, data.js, toast.js, jsx.js
    ignored = ['store.js', 'utils.js', 'data.js', 'toast.js', 'jsx.js']
    files = glob.glob('src/**/*.js', recursive=True)
    for f in files:
        if os.path.basename(f) not in ignored:
            parse_file(f)
