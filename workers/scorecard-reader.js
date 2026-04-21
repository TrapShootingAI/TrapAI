// Cloudflare Worker: Scorecard AI Reader
// Deploy this as a separate Cloudflare Worker (e.g. clayai-scanner.mario-parisi.workers.dev)
// Set the environment variable ANTHROPIC_API_KEY in your Cloudflare dashboard
//
// This worker accepts a POST with a scorecard image and returns parsed scores.

export default {
  async fetch(request, env) {
    // CORS headers
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    if (request.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'POST required' }), {
        status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    try {
      const body = await request.json();
      const { image, teamMembers } = body;
      // image: base64 encoded image data (no data URL prefix)
      // teamMembers: array of known member names for matching

      if (!image) {
        return new Response(JSON.stringify({ error: 'No image provided' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      const apiKey = env.ANTHROPIC_API_KEY;
      if (!apiKey) {
        return new Response(JSON.stringify({ error: 'ANTHROPIC_API_KEY not configured' }), {
          status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      const memberList = (teamMembers || []).join(', ');

      const prompt = `You are reading a USA Clay Target League trap shooting scorecard.

The scorecard has these markings:
- "/" (slash) = Dead Target (HIT - the shooter broke the clay)
- "O" or circle = Lost Target (MISS - the shooter missed)
- The circle often has a small line indicating the direction the target was traveling when missed

Each shooter has 25 shots total (5 stations × 5 shots per station).
Some scorecards have two rows per shooter (Round 1 and Round 2).

Known team members: ${memberList || 'unknown'}

Please read this scorecard and extract the data. For EACH shooter and EACH round, provide:
1. The shooter's name
2. Their 25 shots in order (shot 1 through 25)
3. For each shot: whether it was a HIT or MISS
4. For misses: the direction of the miss line if visible (U=up, D=down, L=left, R=right, UL=up-left, UR=up-right, DL=down-left, DR=down-right)
5. Total hits

Return ONLY valid JSON in this exact format (no other text):
{
  "rounds": [
    {
      "shooterName": "Name",
      "roundNumber": 1,
      "totalHits": 18,
      "shots": [
        {"num": 1, "hit": true},
        {"num": 2, "hit": false, "missDir": "R"},
        ...all 25 shots...
      ]
    }
  ]
}

If a shooter has two rounds on the scorecard, create two entries with roundNumber 1 and 2.
If you cannot read a name, use "Unknown_1", "Unknown_2", etc.
If you cannot determine if a mark is a hit or miss, default to miss.
Match names to the known team members list when possible.`;

      const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 4096,
          messages: [{
            role: 'user',
            content: [
              {
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: 'image/jpeg',
                  data: image,
                },
              },
              {
                type: 'text',
                text: prompt,
              },
            ],
          }],
        }),
      });

      if (!anthropicRes.ok) {
        const err = await anthropicRes.text();
        return new Response(JSON.stringify({ error: 'Anthropic API error', detail: err }), {
          status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      const result = await anthropicRes.json();
      const text = result.content?.[0]?.text || '';

      // Extract JSON from response (handle markdown code blocks)
      let jsonStr = text;
      const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (jsonMatch) jsonStr = jsonMatch[1];
      jsonStr = jsonStr.trim();

      let parsed;
      try {
        parsed = JSON.parse(jsonStr);
      } catch(e) {
        return new Response(JSON.stringify({ error: 'Could not parse AI response', raw: text }), {
          status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      return new Response(JSON.stringify(parsed), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });

    } catch(e) {
      return new Response(JSON.stringify({ error: e.message }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
  }
};
