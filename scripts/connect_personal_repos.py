"""Clone Matko's personal GitHub repos (if missing) and connect them as working projects.

Working projects are writable targets for the coding tool, unlike the
source-only reference clones. Coordinator-owned checkouts (Medical) are
never added here.
"""

import json
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from project_hub.projects import Projects
from init import ROOT


REPOS = [
    ('signbridge-ai', 'signbridge-ai', 'Signbridge AI'),
    ('sportmedical-frontend', 'sportmedical-frontend', 'SportMedical Frontend'),
    ('sportmedical-api', 'sportmedical-api', 'SportMedical API'),
    ('4thebeat', '4thebeat', '4thebeat'),
    ('husky-experience', 'husky-experience', 'Husky Experience'),
    ('AI-Journalist-Studio', 'AI-Journalist-Studio', 'AI Journalist Studio'),
    ('Neuron-Race', 'Neuron-Race', 'Neuron Race'),
    ('solar-ai-analyzer', 'solar-ai-analyzer', 'Solar AI Analyzer'),
    ('test-simple', 'test-simple', 'Test Simple'),
    ('The-Writing-Hub', 'The-Writing-Hub', 'The Writing Hub'),
    ('crypto-ai-project.', 'crypto-ai-project', 'Crypto AI Project'),
    ('bahaaddn', 'bahaaddn', 'Bahaaddn'),
]

HOME = Path.home()


def run(args, timeout=300):
    result = subprocess.run(args, capture_output=True, text=True, errors='replace', timeout=timeout)
    if result.returncode:
        raise RuntimeError('Command failed: %s\n%s' % (' '.join(args), result.stderr[-2000:]))
    return result.stdout


def main():
    projects = Projects(ROOT / 'runtime' / 'project-hub.sqlite')
    summary = []
    for gh_name, folder, display in REPOS:
        target = HOME / folder
        cloned = False
        if not target.is_dir():
            run(['gh', 'repo', 'clone', 'bhaaddin/' + gh_name, str(target)])
            cloned = True
        project = projects.connect(display, [{'label': 'source', 'path': str(target)}])
        try:
            revision = run(['git', '-C', str(target), 'rev-parse', '--short', 'HEAD']).strip()
        except RuntimeError:
            revision = 'no-commits'
        projects.set_metadata(project['id'], {'kind': 'working-clone', 'category': 'personal-working',
                                              'collection': 'working', 'adapter': 'git-source',
                                              'upstream': 'https://github.com/bhaaddin/' + gh_name,
                                              'revisionAtImport': revision, 'writable': True,
                                              'importedAt': datetime.now(timezone.utc).isoformat()})
        summary.append({'project': project['id'], 'folder': folder, 'cloned': cloned, 'revision': revision})
    code_roots = []
    for gh_name, folder, display in REPOS:
        target = HOME / folder
        if target.is_dir():
            code_roots.append({'id': __import__('re').sub(r'[^a-z0-9-]', '-', folder.lower()).strip('-'),
                               'path': str(target)})
    code_config = ROOT / 'operator' / 'config' / 'code.json'
    code_config.write_text(json.dumps({'projects': code_roots}, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(summary, indent=2))
    print('code roots: %d -> %s' % (len(code_roots), code_config))


if __name__ == '__main__':
    main()
