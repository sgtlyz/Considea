"""Optional Tavily CLI entry point with protocol-correct MCP SSE decoding.

The installed CLI uses str.splitlines(), which splits legal U+2028/U+2029
inside JSON strings. SSE line endings are CR/LF only. Authentication remains
entirely owned by Tavily CLI; this shim neither loads nor logs credentials.
"""
import json


def decode_mcp_response(text):
    events = []
    lines = text.replace('\r\n', '\n').replace('\r', '\n').split('\n')
    data = []
    for line in lines + ['']:
        if line == '':
            if data:
                events.append('\n'.join(data))
                data = []
        elif line.startswith('data:'):
            value = line[5:]
            data.append(value[1:] if value.startswith(' ') else value)
    messages = [json.loads(value) for value in events] if events else [json.loads(text)]
    for message in messages:
        if not isinstance(message, dict):
            raise ValueError('Invalid MCP response object')
        if 'error' in message:
            # Do not echo an upstream message that could contain request details.
            raise ValueError('MCP server returned a protocol error')
        if 'result' not in message:
            continue
        result = message['result']
        if not isinstance(result, dict):
            raise ValueError('Invalid MCP result object')
        structured = result.get('structuredContent')
        if structured is not None:
            return structured if isinstance(structured, dict) else json.loads(structured)
        content = result.get('content')
        if content:
            return json.loads(content[0]['text'])
        return result
    raise ValueError('MCP response has no result')


def main():
    import httpx
    from tavily_cli import mcp_client
    from tavily_cli.cli import main as cli_main

    def call(token, tool_name, arguments, session_id=None, human_id=None, client_name=None):
        headers = {'Authorization': f'Bearer {token}', 'Content-Type': 'application/json',
                   'Accept': 'application/json, text/event-stream', 'x-client-source': 'tavily-cli'}
        if client_name:
            headers['x-client-name'] = client_name
        if session_id:
            headers['mcp-session-id'] = session_id
            headers['X-Session-Id'] = session_id
        if human_id:
            headers['X-Human-Id'] = human_id
        response = httpx.post(mcp_client.MCP_URL, headers=headers, timeout=180,
                             json={'jsonrpc': '2.0', 'id': 1, 'method': 'tools/call',
                                   'params': {'name': tool_name, 'arguments': arguments}})
        response.raise_for_status()
        parsed = decode_mcp_response(response.text)
        mcp_client._raise_if_api_error(parsed)
        return parsed

    # Process-local replacement only; installed CLI files and auth are untouched.
    mcp_client._call_mcp_tool = call
    cli_main()


if __name__ == '__main__':
    main()
