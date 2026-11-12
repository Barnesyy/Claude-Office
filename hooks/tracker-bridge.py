# tracker-bridge.py - runs hooks/agent-tracker.py on many hook payloads in one
# long-lived process, for the hookless transcript mode (server/transcript-source.js).
#
# Nothing here is installed into Claude Code. The transcript watcher rebuilds
# hook-shaped payloads from the JSONL transcripts Claude Code writes anyway and
# writes them here, one JSON object per line on stdin. For each line this runs
# the unchanged agent-tracker.py (same role mapping, call keys, Bash signals as
# the hook mode) and answers with one line on stdout:
#   {"events": [<office event>, ...]}
# The tracker's signature / wait / claim lines are dropped: the watcher POSTs
# with the office token itself and never answers a dialog or claims a prompt.
# Standard library only.
import io, json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
with open(os.path.join(HERE, 'agent-tracker.py'), encoding='utf-8') as f:
    CODE = compile(f.read(), os.path.join(HERE, 'agent-tracker.py'), 'exec')

# Never sign, never see the answer-permissions marker or a prompt-queue marker:
# the office cannot answer a dialog it only read about in a transcript.
os.environ.pop('OFFICE_TOKEN', None)
os.environ['AGENT_OFFICE_HOME'] = os.path.join(HERE, '.no-office-home-for-bridge')

real_in = sys.stdin
real_out = sys.stdout

def run_one(line):
    captured = io.StringIO()
    sys.stdin = io.StringIO(line)
    sys.stdout = captured
    try:
        exec(CODE, {'__name__': '__main__', '__file__': os.path.join(HERE, 'agent-tracker.py')})
    except SystemExit:
        pass
    except Exception as exc:  # a tracker bug costs this one payload, never the bridge
        sys.stderr.write('[tracker-bridge] %s: %s\n' % (type(exc).__name__, exc))
    finally:
        sys.stdin = real_in
        sys.stdout = real_out
    events = []
    for out_line in captured.getvalue().splitlines():
        out_line = out_line.strip()
        if out_line.startswith('{'):
            try:
                event = json.loads(out_line)
            except Exception:
                continue
            if isinstance(event, dict) and event.get('type'):
                events.append(event)
    return events

for raw in real_in:
    raw = raw.strip()
    if not raw:
        continue
    real_out.write(json.dumps({'events': run_one(raw)}) + '\n')
    real_out.flush()
