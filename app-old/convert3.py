import os
import glob
import re

def process_file(filepath):
    with open(filepath, 'r', encoding='utf-8') as f:
        code = f.read()

    # 1. Strip the HTML import
    code = re.sub(r"import\s*\{\s*html\s*\}\s*from\s*['\"]\.\.?/(?:\.\./)*jsx\.js['\"];?\s*", "", code)

    # 2. Fix the return html`...` -> return ( ... )
    code = re.sub(r'return\s+html`', 'return (', code)
    code = re.sub(r'export default function.*?html`', lambda m: m.group(0).replace('html`', '('), code, flags=re.DOTALL)
    
    # In some places it's just html`...` (e.g., variable assignments or inline renders)
    code = re.sub(r'html`', '(', code)

    # 3. Replace `<${Component}` -> `<Component`
    code = re.sub(r'<\$\{([^}]+)\}', r'<\1', code)
    code = re.sub(r'</\$\{([^}]+)\}', r'</\1', code)

    # 4. Handle trailing backticks on lines
    code = re.sub(r'/>`', r'/>', code)
    code = re.sub(r'/>`}', r'/>}', code)
    code = re.sub(r'`\)}', r')}', code)
    code = re.sub(r'`\s*:\s*null}', r' : null}', code)
    code = re.sub(r'`\s*:', r' :', code)
    code = re.sub(r'`}', r'}', code)
    
    # 5. Fix classNames
    def replace_class(m):
        attr = m.group(1) # class or className
        quote = m.group(2) # " or '
        content = m.group(3)
        if '${' in content:
            return f'className={{`{content}`}}'
        else:
            return f'className={quote}{content}{quote}'
            
    code = re.sub(r'\b(class|className)=([\'"])(.*?)\2', replace_class, code)

    # 6. Replace all remaining `${` with `{` (since template literals in className are now wrapped in {`...`})
    parts = code.split('`')
    for i in range(len(parts)):
        if i % 2 == 0:
            parts[i] = parts[i].replace('${', '{')
            
    code = '`'.join(parts)
    
    # 7. Remove the final closing backtick from html`...`
    # In main.jsx, it's `\n);
    # In App.jsx, it's `;
    code = re.sub(r'`\s*\n\s*\)\s*;', '\n  );\n);', code)  # Fix for main.jsx that needs extra ) before );
    code = re.sub(r'`\s*\n\s*\)', '\n)', code)
    code = re.sub(r'`\s*;', ');', code)
    code = re.sub(r'`\s*$', ')', code)

    # 8. Update .js imports to .jsx if needed (local imports)
    code = re.sub(r"from\s+(['\"])(.*?)\.js\1", r"from \1\2.jsx\1", code)

    # Output as JSX
    new_filepath = filepath + 'x'
    with open(new_filepath, 'w', encoding='utf-8') as f:
        f.write(code)

    os.remove(filepath)

if __name__ == '__main__':
    for filepath in glob.glob('src/**/*.js', recursive=True):
        if filepath.endswith('.jsx'):
            continue
        # Skip jsx.js
        if os.path.basename(filepath) == 'jsx.js':
            continue
        process_file(filepath)
