// GH337 — askpass de Polenta (design §6). Sans dépendance : il se connecte au serveur d'identifiants
// de l'hôte (pipe nommé ou socket unix), envoie { nonce, prompt } et écrit la valeur sur stdout.
'use strict'
const net = require('net')

const promptText = process.argv[2] || ''
const endpoint = process.env.POLENTA_ASKPASS_PIPE
const nonce = process.env.POLENTA_ASKPASS_NONCE

function fail() {
  process.exitCode = 1
}

if (!endpoint || !nonce) {
  fail()
} else {
  const sock = net.connect(endpoint)
  let buf = ''
  sock.setEncoding('utf8')
  sock.on('connect', () => sock.write(JSON.stringify({ nonce, prompt: promptText }) + '\n'))
  sock.on('data', chunk => { buf += chunk })
  sock.on('end', () => {
    let value = ''
    try {
      value = JSON.parse(buf).value || ''
    } catch {
      fail()
    }
    process.stdout.write(value + '\n')
  })
  sock.on('error', fail)
}
