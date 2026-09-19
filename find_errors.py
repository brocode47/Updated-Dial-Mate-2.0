import glob
for f in glob.glob('src/**/*.jsx', recursive=True):
    with open(f, encoding='utf-8') as file:
        for i, l in enumerate(file):
            if '`' in l or '${' in l:
                print(f'{f}:{i+1} {l.strip()}')
