const args = process.argv.slice(2);
const index = args.indexOf('--include-domains');
process.stdout.write(JSON.stringify({ results: [{ url: 'https://devpost.com/software/planner',
  title: 'Planner', content: index >= 0 ? args[index + 1] : 'missing domain filter' }] }) + '\n');
