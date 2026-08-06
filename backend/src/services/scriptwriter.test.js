const { writeEpisodeScript, ScriptwriterError } = require('./scriptwriter');

// A fake Anthropic client: captures the request and returns a canned response.
function fakeClient(response) {
  const calls = [];
  return {
    calls,
    messages: {
      create: async (params) => {
        calls.push(params);
        return response;
      },
    },
  };
}

function jsonResponse(obj, stopReason = 'end_turn') {
  return {
    stop_reason: stopReason,
    content: [
      { type: 'thinking', thinking: '' },
      { type: 'text', text: JSON.stringify(obj) },
    ],
  };
}

const SEGMENTS = [
  { title: 'Council approves budget', text: 'The city council approved the annual budget on Tuesday. '.repeat(20), url: 'https://ex.com/a' },
  { title: 'New park opens downtown', text: 'A new riverfront park opened to the public this weekend. '.repeat(20), url: 'https://ex.com/b' },
];

describe('writeEpisodeScript', () => {
  test('returns the parsed script fields from the LLM JSON', async () => {
    const client = fakeClient(jsonResponse({
      title: 'Greenville Daily — Aug 6',
      scriptText: 'Good morning, it\'s Wednesday, August 6th. Today the city council...',
      showNotesHtml: '<p>Today: <a href="https://ex.com/a">budget</a></p>',
      description: 'City budget approved and a new park opens downtown.',
    }));

    const out = await writeEpisodeScript({
      segments: SEGMENTS,
      showName: 'Greenville Daily',
      date: new Date('2026-08-06T12:00:00Z'),
      client,
    });

    expect(out.title).toBe('Greenville Daily — Aug 6');
    expect(out.scriptText).toContain('city council');
    expect(out.showNotesHtml).toContain('<a href="https://ex.com/a">');
    expect(out.description).toBe('City budget approved and a new park opens downtown.');
  });

  test('assembles a request with structured-output format and the article text', async () => {
    const client = fakeClient(jsonResponse({
      title: 't', scriptText: 's', showNotesHtml: '<p>n</p>', description: 'd',
    }));

    await writeEpisodeScript({ segments: SEGMENTS, showName: 'Greenville Daily', client });

    const req = client.calls[0];
    expect(req.output_config.format.type).toBe('json_schema');
    expect(req.messages[0].content).toContain('Council approves budget');
    expect(req.messages[0].content).toContain('https://ex.com/a');
  });

  test('caps the description at 500 characters', async () => {
    const client = fakeClient(jsonResponse({
      title: 't', scriptText: 's', showNotesHtml: '<p>n</p>', description: 'x'.repeat(900),
    }));
    const out = await writeEpisodeScript({ segments: SEGMENTS, client });
    expect(out.description).toHaveLength(500);
  });

  test('rejects empty input without calling the LLM', async () => {
    const client = fakeClient(jsonResponse({}));
    await expect(writeEpisodeScript({ segments: [], client }))
      .rejects.toThrow(ScriptwriterError);
    expect(client.calls).toHaveLength(0);
  });

  test('throws on a refusal stop reason', async () => {
    const client = fakeClient(jsonResponse({ title: 't', scriptText: 's', showNotesHtml: 'n', description: 'd' }, 'refusal'));
    await expect(writeEpisodeScript({ segments: SEGMENTS, client }))
      .rejects.toMatchObject({ code: 'refusal' });
  });

  test('throws when the model returns non-JSON text', async () => {
    const client = fakeClient({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'not json' }] });
    await expect(writeEpisodeScript({ segments: SEGMENTS, client }))
      .rejects.toMatchObject({ code: 'bad_output' });
  });

  test('throws when the script is empty even if JSON is valid', async () => {
    const client = fakeClient(jsonResponse({ title: 't', scriptText: '   ', showNotesHtml: 'n', description: 'd' }));
    await expect(writeEpisodeScript({ segments: SEGMENTS, client }))
      .rejects.toMatchObject({ code: 'bad_output' });
  });
});
