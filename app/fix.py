import glob
import re

def fix_file(f):
    with open(f, 'r', encoding='utf-8') as file:
        code = file.read()
    
    # 1. Remove floating backticks that match known patterns
    code = code.replace("/>`", "/>")
    code = code.replace("/>`}", "/>}")
    code = code.replace("`)}", ")}")
    code = code.replace("` : null}", " : null}")
    code = code.replace("` :", " :")
    code = code.replace("`}", "}")
    code = code.replace("`\n", "\n")
    code = code.replace("? <", "? (<")
    # Actually wait, `? <img /> : <img />` is valid JSX. No need to wrap in ().
    
    # 2. Fix ${ to { ONLY when it is inside JSX (not inside template strings)
    # Since we removed most of the bad backticks, any remaining backticks are probably real template strings!
    # So we can replace `${` with `{` EXCEPT when inside a template string!
    # How to know if inside template string? We can just split by '`'.
    # Even elements (0, 2, 4...) are OUTSIDE template strings.
    # Odd elements (1, 3, 5...) are INSIDE template strings.
    
    parts = code.split('`')
    for i in range(len(parts)):
        if i % 2 == 0:
            # OUTSIDE template string. So `${` means JSX interpolation!
            parts[i] = parts[i].replace("${", "{")
        else:
            # INSIDE template string. `${` is a JS interpolation, keep it!
            pass
            
    code = "`".join(parts)
    
    with open(f, 'w', encoding='utf-8') as file:
        file.write(code)

if __name__ == '__main__':
    for f in glob.glob('src/**/*.jsx', recursive=True):
        fix_file(f)
