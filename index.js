import 'dotenv/config'
import express from 'express'
import ws from 'ws'
import { createClient } from '@supabase/supabase-js'

const app = express()
app.use(express.json())

const PORT = process.env.PORT || 3000

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

app.get('/test-db', async (req, res) => {
  const { data, error } = await supabase
    .from('campaign_reports')
    .select('*')
    .limit(5)

  if (error) {
    return res.status(500).json({
      error: error.message
    })
  }

  res.json({
    message: 'Supabase connected',
    data
  })
})

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`)
})