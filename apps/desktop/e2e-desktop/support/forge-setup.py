#!/usr/bin/env python3
"""GH45 — préparation d'une instance du kit pour les tests d'intégration et d'interface.
Exécuté en root SUR L'HÔTE (lit /opt/polenta/instances/<instance>/instance.env) :

  sudo python3 forge-setup.py accounts <instance>        → JSON des comptes de test (stdout)
  sudo python3 forge-setup.py config <instance> <b64>     → remplace <org>/polenta-config/config.yaml
                                                            (en tant que propriétaire : compte d'exploitation)

Comptes (re)créés : itest-auteur (auteurs), itest-testeur (testeurs), itest-lecteur (lecteurs),
itest-2fa (auteurs, TOTP), itest-neuf (mot de passe temporaire) ; repo <org>/itest (main + .gitignore).
"""
import base64, hashlib, hmac, http.cookiejar, json, os, re, struct, sys, time, urllib.error, urllib.parse, urllib.request

cmd, inst = sys.argv[1], sys.argv[2]
env = dict(l.split('=', 1) for l in open(f'/opt/polenta/instances/{inst}/instance.env').read().splitlines() if '=' in l)
DOM, OPS, ORG = env['DOMAIN'], env['OPS_TOKEN'], env['ORG']
BASE = f'https://{DOM}'


def req(method, path, body=None, token=OPS, raw=False, opener=None, data=None):
    url = path if path.startswith('http') else BASE + '/api/v1' + path
    h = {'Accept': 'application/json'}
    if token: h['Authorization'] = 'token ' + token
    if body is not None:
        data = json.dumps(body).encode(); h['Content-Type'] = 'application/json'
    elif data is not None:
        h.update({'Origin': BASE, 'Sec-Fetch-Site': 'same-origin', 'Content-Type': 'application/x-www-form-urlencoded'})
    op = opener or urllib.request.build_opener()
    try:
        r = op.open(urllib.request.Request(url, data=data, method=method, headers=h), timeout=60)
        c, t = r.status, r.read().decode()
    except urllib.error.HTTPError as e:
        c, t = e.code, e.read().decode()
    if raw: return c, t
    try: return c, json.loads(t)
    except Exception: return c, t


def pw(): return 'It-' + base64.b32encode(os.urandom(10)).decode().rstrip('=')


def team_id(name):
    return next(t['id'] for t in req('GET', f'/orgs/{ORG}/teams?limit=50')[1] if t['name'] == name)


def user(login, team, must_change=False):
    req('DELETE', f'/admin/users/{login}?purge=true')
    p = pw()
    c, j = req('POST', '/admin/users', {'username': login, 'email': f'{login}@esquaresoft.fr', 'full_name': f'Test {login}',
                                         'password': p, 'must_change_password': must_change, 'login_name': login, 'source_id': 0})
    assert c == 201, (c, j)
    req('PUT', f'/teams/{team_id(team)}/members/{login}')
    return p


def totp(secret):
    key = base64.b32decode(secret + '=' * (-len(secret) % 8))
    d = hmac.new(key, struct.pack('>Q', int(time.time() // 30)), hashlib.sha1).digest(); o = d[-1] & 15
    return '%06d' % ((struct.unpack('>I', d[o:o + 4])[0] & 0x7fffffff) % 1000000)


def enroll_2fa(login, password):
    cj = http.cookiejar.CookieJar(); op = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj))
    c, html = req('GET', BASE + '/user/login', token=None, raw=True, opener=op)
    f = {'user_name': login, 'password': password}
    m = re.search(r'name="_csrf" value="([^"]+)"', html)
    if m: f['_csrf'] = m.group(1)
    req('POST', BASE + '/user/login', token=None, raw=True, opener=op, data=urllib.parse.urlencode(f).encode())
    c, html = req('GET', BASE + '/user/settings/security/two_factor/enroll', token=None, raw=True, opener=op)
    secret = re.search(r'\b([A-Z2-7]{16,})\b', html).group(1)
    f = {'passcode': totp(secret)}
    m = re.search(r'name="_csrf" value="([^"]+)"', html)
    if m: f['_csrf'] = m.group(1)
    req('POST', BASE + '/user/settings/security/two_factor/enroll', token=None, raw=True, opener=op, data=urllib.parse.urlencode(f).encode())
    return secret


if cmd == 'accounts':
    out = {'instance': inst, 'baseUrl': BASE, 'org': ORG}
    out['auteur'] = user('itest-auteur', 'auteurs')
    out['testeur'] = user('itest-testeur', 'testeurs')
    out['lecteur'] = user('itest-lecteur', 'lecteurs')
    p2 = user('itest-2fa', 'auteurs')
    out['twofa'] = {'password': p2, 'secret': enroll_2fa('itest-2fa', p2)}
    out['neuf'] = user('itest-neuf', 'auteurs', must_change=True)
    req('DELETE', f'/repos/{ORG}/itest')
    c, j = req('POST', f'/orgs/{ORG}/repos', {'name': 'itest', 'private': True, 'auto_init': False, 'default_branch': 'main'})
    assert c == 201, (c, j)
    c, j = req('POST', f'/repos/{ORG}/itest/contents/.gitignore', {'content': base64.b64encode(b'.polenta/tree.cache.yaml\n*.pref\n').decode(),
                                                                    'message': 'init', 'branch': 'main', 'new_branch': 'main'})
    assert c == 201, (c, j)
    print(json.dumps(out))
elif cmd == 'config':
    content = base64.b64decode(sys.argv[3])
    c, cur = req('GET', f'/repos/{ORG}/polenta-config/contents/config.yaml')
    assert c == 200, (c, cur)
    c, j = req('PUT', f'/repos/{ORG}/polenta-config/contents/config.yaml',
               {'content': base64.b64encode(content).decode(), 'sha': cur['sha'], 'message': 'tests GH45 : configuration de test'})
    assert c == 200, (c, j)   # propriétaire : autorisé malgré la protection de main (critère 24)
    print(json.dumps({'ok': True}))
else:
    sys.exit(f'commande inconnue : {cmd}')
