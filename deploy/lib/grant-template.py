#!/usr/bin/env python3
"""GH57 — page de consentement OAuth2 de la forge, validée automatiquement pour le client web.

    python3 grant-template.py <modèle-d-origine> <client_id>

Écrit sur la sortie standard un modèle `templates/user/auth/grant.tmpl` pour le dossier `custom` de
la forge (Forgejo ou Gitea) : pour l'application dont le `client_id` est donné (application
`polenta-web` de l'instance), une page de transition qui envoie aussitôt le formulaire
d'autorisation d'origine ; pour toute autre application, le modèle d'origine inchangé.

Codes de sortie : 0 généré ; 2 usage ou client_id invalide ; 3 modèle d'origine de forme
inattendue (version de la forge à vérifier — la page d'origine doit alors être conservée).
Bibliothèque standard uniquement (specs/GH57-design.md §2).
"""
import re
import sys

CLIENT_ID = re.compile(r'[A-Za-z0-9-]{8,64}')  # fullmatch : « $ » accepterait un saut de ligne final
# Erreur signalée par la forge sur la page (même test que son modèle base/alert) : pas d'envoi auto.
FLASH = '(or .Flash.ErrorMsg .Flash.WarningMsg)'
FORM = re.compile(r'<form\b[^>]*>.*?</form>', re.S)
GRANT_ACTION = re.compile(r'\baction="\{\{AppSubUrl\}\}/login/oauth/grant"')
GRANT_BUTTON = re.compile(r'<button\b[^>]*\bname="granted"[^>]*\bvalue="true"[^>]*>')
BUTTON = re.compile(r'\s*<button\b.*?</button>', re.S)
DEFINES = re.compile(r'\{\{-?\s*(define|block)\b')
FORM_OPEN = re.compile(r'<form\b[^>]*>')
ID_ATTR = re.compile(r'\s+id="[^"]*"')

HEADER = ('{{/* Généré par polenta-host (GH57) — ne pas éditer : régénéré à chaque « instance web enable »\n'
          '     et « instance update ». Client web : autorisation validée automatiquement. */}}\n')


class UnexpectedTemplate(Exception):
    pass


def transition_form(original: str) -> str:
    """Formulaire d'autorisation d'origine, sans ses boutons, envoyé avec `granted=true`."""
    forms = [m.group(0) for m in FORM.finditer(original) if GRANT_ACTION.search(m.group(0))]
    if len(forms) != 1:
        raise UnexpectedTemplate(f'{len(forms)} formulaire(s) vers /login/oauth/grant (1 attendu)')
    form = forms[0]
    if not GRANT_BUTTON.search(form):
        raise UnexpectedTemplate('bouton name="granted" value="true" introuvable')
    opening = FORM_OPEN.match(form).group(0)
    form = ID_ATTR.sub('', opening).replace('<form', '<form id="polenta-grant"', 1) + form[len(opening):]
    form = BUTTON.sub('', form)
    # form.submit() ne transmet pas de bouton : la valeur du bouton « Autoriser » devient un champ.
    # Bouton visible seulement sans JavaScript, ou si la forge signale une erreur (pas d'envoi
    # automatique en boucle).
    button = '<button type="submit" class="ui red inline button">{{ctx.Locale.Tr "auth.authorize_application"}}</button>'
    extra = ('\n\t<input type="hidden" name="granted" value="true">'
             f'\n\t{{{{if {FLASH}}}}}{button}{{{{else}}}}<noscript>{button}</noscript>{{{{end}}}}\n')
    return form[:-len('</form>')] + extra + '</form>'


def generate(original: str, client_id: str) -> str:
    if DEFINES.search(original):
        raise UnexpectedTemplate('le modèle définit des blocs ({{define}}/{{block}})')
    form = transition_form(original)
    page = (
        '{{template "base/head" .}}\n'
        '<div role="main" aria-label="{{.Title}}" class="page-content">\n'
        '\t<div class="ui container tw-text-center tw-my-8">\n'
        '\t\t{{template "base/alert" .}}\n'
        f'\t\t{{{{if not {FLASH}}}}}<p>{{{{ctx.Locale.Tr "loading"}}}}</p>{{{{end}}}}\n'
        f'{form}\n'
        '\t</div>\n'
        '</div>\n'
        f"{{{{if not {FLASH}}}}}<script>document.getElementById('polenta-grant').submit()</script>{{{{end}}}}\n"
        '{{template "base/footer" .}}\n'
    )
    if not original.endswith('\n'):
        original += '\n'
    return f'{HEADER}{{{{if eq .Application.ClientID "{client_id}"}}}}\n{page}{{{{else}}}}\n{original}{{{{end}}}}\n'


def main(argv: list[str]) -> int:
    if len(argv) != 3:
        print(__doc__.strip().splitlines()[2].strip(), file=sys.stderr)
        return 2
    path, client_id = argv[1], argv[2]
    if not CLIENT_ID.fullmatch(client_id):
        print(f'client_id invalide : « {client_id} »', file=sys.stderr)
        return 2
    with open(path, encoding='utf-8') as f:
        original = f.read()
    try:
        # Octets UTF-8 quel que soit l'environnement (LANG=C sous sudo, console Windows).
        sys.stdout.buffer.write(generate(original, client_id).encode('utf-8'))
    except UnexpectedTemplate as e:
        print(f'page de consentement de forme inattendue : {e}', file=sys.stderr)
        return 3
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))
