$env:PAPER_TRADING="true"
node index.js 2>&1 | Tee-Object -FilePath "paper-test.log"
