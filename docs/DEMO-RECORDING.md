# Demo video

Current demo: [YouTube](https://youtu.be/d4RyloKY-rE) · [Website](https://considea.vercel.app/demo.html). Updated from the supplied `demo.mp4` on October 4, 2026.

## Interactive team simulation

The eight-step text walkthrough on `/demo.html` is an authored simulation, separate from the video and the historical live acceptance run. Alice and Bob progress from a disagreement about task tracking to a smaller handoff-board proposal, request a revision and accept version 2 with a concrete build and validation plan.

`workflow/web/demo-data.json` contains the scenario; `demo-zh.json` contains its Chinese translations. Candidate assessments are illustrative and preserve unresolved usefulness, novelty and implementation questions. No new live model calls, search results, completed prototype or user study are claimed. Each discussion round represents approved shared statements following private interviews; private follow-ups are summarized, not exposed.

The notes below document the earlier recorded run, not the current replacement video or text simulation.

## Original recorded walkthrough

Historical recording notes follow. The current public page and MP4 have since been replaced.

The 83-second silent video is edited from actual Chrome recordings of the successful development run on October 4, 2026. English captions explain each step. DeepSeek and Tavily calls were real; Alice and Bob are scripted test participants. Waiting periods and repeated steps are shortened. The final brief/export segment was recorded from the same completed room afterward without additional model calls.

| Time | Chapter |
| --- | --- |
| 0:00 | Private interview |
| 0:08 | Approve the shared summary |
| 0:16 | Answer the difference |
| 0:23 | Second discussion round |
| 0:28 | Third discussion round |
| 0:33 | Fourth round and team convergence |
| 0:44 | Review research and request a revision |
| 0:54 | Resume after rejected evaluator output |
| 1:00 | Evaluate version 2 and accept again |
| 1:10 | Read and export the accepted brief |

The video is H.264, 1280 x 1000, 24 fps, with fast-start metadata. It is about 3 MB. At the time, the page served static video and approved shared results; the current text walkthrough uses the simulation described above. Neither version creates a room or calls a model. Browser acceptance checks playback, seeking, all eight replay steps, keyboard navigation, mobile width and the absence of API requests.

The raw footage and edit timeline remain in ignored `workflow/data/dev-live/`. Recordings do not show API keys, invitations or recovery codes. The historical live-run evidence retains its insufficient-evidence findings; it is not the source of the current simulated candidate assessments. See [release acceptance](DEV-ACCEPTANCE.md) for the failed-attempt history, persistence checks and deployment limits.
