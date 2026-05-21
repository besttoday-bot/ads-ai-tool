import 'dotenv/config'
import ws from 'ws'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY,
  {
    realtime: {
      transport: ws
    }
  }
)

async function test() {
  const { data, error } = await supabase
    .from('campaign_reports')
    .select('*')

  if (error) {
    console.log('ERROR:', error)
  } else {
    console.log('SUCCESS')
    console.log(data)
  }
}

test()
