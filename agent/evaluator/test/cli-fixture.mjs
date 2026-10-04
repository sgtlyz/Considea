// A local subprocess exercising the real CLI adapter; never sends network requests.
const args = process.argv.slice(2);
if (args[0] === 'search') console.log(JSON.stringify({ results: [{ url: 'https://example.com',
  title: args[1], content: `UTF8：${process.env.PYTHONIOENCODING}` }] }));
else if (args[0] === 'extract') console.log(JSON.stringify({ results: [{ url: args[1], raw_content: '正文' }], failed_results: [] }));
else process.exit(2);
