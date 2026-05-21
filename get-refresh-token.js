import readline from 'readline'
import { google } from 'googleapis'

const CLIENT_ID = '881254471022-ldvo38mifq42bkqn0ntv8udbm38cqrkk.apps.googleusercontent.com'
const CLIENT_SECRET = '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'

const oauth2Client = new google.auth.OAuth2(
  CLIENT_ID,
  CLIENT_SECRET,
  'http://localhost'
)

const authUrl = oauth2Client.generateAuthUrl({
  access_type: 'offline',
  prompt: 'consent',
  scope: ['https://www.googleapis.com/auth/adwords']
})

console.log('\nこのURLをブラウザで開いてください:\n')
console.log(authUrl)

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
})

rl.question('\ncode= の値を貼ってください: ', async (code) => {
  const { tokens } = await oauth2Client.getToken(code)

  console.log('\nREFRESH TOKEN:\n')
  console.log(tokens.refresh_token)

  rl.close()
})
