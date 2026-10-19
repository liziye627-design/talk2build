import json, subprocess as sp, os, re, glob
V = sorted(glob.glob('vid/*.webm'), key=os.path.getmtime)[-1]
m = json.load(open('marks.json')); d = json.load(open('aud/dur.json'))
asr = json.load(open('aud/asr.json')); text = json.load(open('narration.json'))
names = [k for k in m if k != '__end']; ends = [m[n] for n in names[1:]] + [m['__end']]
OUT = '/workspace/t2b/demo/talk2build-demo-v2.mp4'
enc = ['-c:v','libx264','-preset','medium','-crf','18','-pix_fmt','yuv420p','-r','30',
       '-color_primaries','bt709','-color_trc','bt709','-colorspace','bt709',
       '-c:a','aac','-b:a','192k','-ar','48000','-ac','2']
os.makedirs('seg', exist_ok=True)
for f in glob.glob('seg/*'): os.remove(f)
DELAY = 0.3
plan = []  # (file, narration key, length, caption?)
def card(out, png, key, L, delay=0.4):
    sp.run(['ffmpeg','-y','-v','error','-loop','1','-framerate','30','-t',str(L),'-i',png,'-i',f'aud/{key}.wav',
      '-filter_complex',f'[0:v]scale=1920:1080,fade=t=in:d=0.4,fade=t=out:st={L-0.5}:d=0.5,format=yuv420p[v];'
      f'[1:a]adelay={int(delay*1000)}|{int(delay*1000)},apad,atrim=0:{L},aformat=channel_layouts=stereo[a]',
      '-map','[v]','-map','[a]']+enc+[out], check=True)
card('seg/00.mp4', 'cards/title.png', 'title', round(d['title'] + 1.6, 2)); plan.append(('seg/00.mp4','title',0.4,False))
for i, (n, e) in enumerate(zip(names, ends), 1):
    L = round(e - m[n], 3); out = f'seg/{i:02d}.mp4'
    sp.run(['ffmpeg','-y','-v','error','-ss',str(m[n]),'-t',str(L),'-i',V,'-i',f'aud/{n}.wav',
      '-filter_complex',f'[0:v]scale=1920:1080,fps=30,format=yuv420p[v];[1:a]adelay=300|300,apad,atrim=0:{L},aformat=channel_layouts=stereo[a]',
      '-map','[v]','-map','[a]']+enc+[out], check=True)
    plan.append((out, n, DELAY, True))
card('seg/90.mp4', 'cards/how.png', 's11_how', round(d['s11_how'] + 1.4, 2)); plan.append(('seg/90.mp4','s11_how',0.4,True))
card('seg/99.mp4', 'cards/end.png', 'end', round(d['end'] + 2.6, 2)); plan.append(('seg/99.mp4','end',0.4,False))

def dur(f): return float(sp.check_output(['ffprobe','-v','error','-show_entries','format=duration','-of','csv=p=0',f]).decode())

def chunks(t):
    parts = re.split(r'(?<=[.?!])\s+', t.strip()); out = []
    for p in parts:
        while len(p) > 62:
            cut = max(p.rfind(', ', 0, 62), p.rfind(' ', 0, 56))
            cut = cut + 1 if p[cut] == ',' else cut
            out.append(p[:cut].strip()); p = p[cut:].strip()
        if p: out.append(p)
    return out

def time_at(words, frac):
    # map a fraction of characters to a time on the recognised-word timeline
    tot = sum(len(w['w']) for w in words); target = frac * tot; acc = 0
    for w in words:
        if acc + len(w['w']) >= target:
            r = (target - acc) / max(len(w['w']), 1); return w['s'] + r * (w['e'] - w['s'])
        acc += len(w['w'])
    return words[-1]['e']

def ts(x):
    h = int(x // 3600); mm = int(x % 3600 // 60); s = x % 60; return f'{h}:{mm:02d}:{s:05.2f}'
events = []; timeline = []; t = 0
for f, key, delay, cap in plan:
    L = dur(f); timeline.append({'seg': f, 'key': key, 'start': round(t, 2), 'end': round(t + L, 2)})
    if cap:
        cs = chunks(text[key]); tot = sum(len(c) for c in cs); acc = 0; words = asr[key]['words']
        for c in cs:
            a = time_at(words, acc / tot); acc += len(c); b = time_at(words, acc / tot)
            events.append((t + delay + a, min(t + delay + b + 0.25, t + L), c))
    t += L
ass = ['[Script Info]','ScriptType: v4.00+','PlayResX: 1920','PlayResY: 1080','',
 '[V4+ Styles]','Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
 'Style: Cap,DejaVu Sans,44,&H00FFFFFF,&H00FFFFFF,&H80000000,&H99101018,0,0,0,0,100,100,0,0,3,14,0,2,120,120,46,1','',
 '[Events]','Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text']
for a, b, c in events: ass.append(f'Dialogue: 0,{ts(a)},{ts(b)},Cap,,0,0,0,,{c}')
open('captions.ass', 'w').write('\n'.join(ass) + '\n')
open('list.txt', 'w').write(''.join(f"file '{p[0]}'\n" for p in plan))
sp.run(['ffmpeg','-y','-v','error','-f','concat','-safe','0','-i','list.txt','-vf','ass=captions.ass',
        '-af','loudnorm=I=-16:TP=-1.5:LRA=11,aresample=48000'] + enc + ['-movflags','+faststart', OUT], check=True)
json.dump({'timeline': timeline, 'captions': [{'start': round(a,2), 'end': round(b,2), 'text': c} for a,b,c in events]}, open('timeline.json','w'), indent=1)
print(round(t, 2), len(events))
