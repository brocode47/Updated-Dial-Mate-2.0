import os
import glob
import re

def process_file(filepath):
    with open(filepath, 'r', encoding='utf-8') as f:
        code = f.read()
        
    # Remove import { html } from './jsx.js';
    code = re.sub(r"import\s*\{\s*html\s*\}\s*from\s*['\"]\.\.?/(?:\.\./)*jsx\.js['\"];?\s*", "", code)

    out = []
    i = 0
    # States
    in_html = 0
    in_template_string = 0
    
    while i < len(code):
        if code[i:i+5] == 'html`':
            in_html += 1
            i += 5
            # We don't output html`
            # Instead we might need a fragment <>, but let's assume it's not needed or just wrap in ()
            if in_html == 1:
                out.append('(')
            else:
                out.append('<>')
            continue
            
        if code[i] == '`':
            if in_html > 0:
                # Is it closing the html` or is it a new template string?
                # HTM doesn't have template strings inside the html body unless it's inside ${}
                # Wait, inside ${}, we could have template strings!
                # But inside ${}, we are in JS mode.
                pass
            
        # This is getting too complex.
    
if __name__ == '__main__':
    pass
