import 'dotenv/config'
import express from 'express'
import ws from 'ws'
import OpenAI from 'openai'
import { createClient } from '@supabase/supabase-js'

const app = express()
app.use(express.json())

const PORT = process.env.PORT || 3000

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
})

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY,
  {
    realtime: {
      transport: ws
    }
  }
)

app.get('/', (req, res) => {
  res.send('ads-ai-tool server is running')
})

app.get('/analyze', async (req, res) => {
  const { data, error } = await supabase
    .from('campaign_reports')
    .select('*')
    .order('id', { ascending: false })
    .limit(5)

  if (error) {
    return res.status(500).json({
      error: error.message
    })
  }

  const prompt = `
以下の広告データを分析して、
改善提案をしてください。

${JSON.stringify(data, null, 2)}
`

  const completion = await openai.chat.completions.create({
    model: 'gpt-4.1-mini',
    messages: [
      {
        role: 'user',
        content: prompt
      }
    ]
  })

  res.json({
    analysis: completion.choices[0].message.content
  })
})

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`)
})