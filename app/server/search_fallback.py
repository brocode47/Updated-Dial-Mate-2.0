import os

target_strings = ['DEFAULT_SHOP_DOMAIN', 'test.myshopify.com']

def search_files(directory):
    for root, dirs, files in os.walk(directory):
        if 'node_modules' in dirs:
            dirs.remove('node_modules')
        if '.git' in dirs:
            dirs.remove('.git')
        
        for file in files:
            if file.endswith('.js') or file.endswith('.json') or file.endswith('.env'):
                path = os.path.join(root, file)
                try:
                    with open(path, 'r', encoding='utf-8') as f:
                        lines = f.readlines()
                        for i, line in enumerate(lines):
                            for target in target_strings:
                                if target in line:
                                    print(f"Found {target} in {path}:{i+1}")
                except Exception as e:
                    pass

search_files('.')
