import glob
import re

for filepath in glob.glob('src/**/*.jsx', recursive=True):
    with open(filepath, 'r', encoding='utf-8') as f:
        code = f.read()
    
    # 1. `\n);\n
    code = re.sub(r'`\s*\n\s*\);\s*$', '\n);', code)
    code = re.sub(r'`\s*\n\s*\)\s*$', '\n)', code)
    
    # 2. ? <Loader />` : <Icon />`
    code = re.sub(r'\/>`\s*:', '/> :', code)
    
    with open(filepath, 'w', encoding='utf-8') as f:
        f.write(code)
