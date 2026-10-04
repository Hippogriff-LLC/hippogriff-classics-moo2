#!/usr/bin/env python3
"""Research helper: symbolised disassembly of an extracted image (see extract-image.ts).

Runs binutils objdump over the relocated code object and annotates function starts and absolute
operands with Watcom debug symbol names. Output is derived from proprietary program bytes and is
written only to the private scratch directory given on the command line.

    python3 tools/re/disasm.py <scratch-dir>            # writes <scratch-dir>/disasm.txt
    python3 tools/re/disasm.py <scratch-dir> Name_      # print one function to stdout
"""
import bisect, json, os, re, subprocess, sys

def load(scratch):
    img = json.load(open(os.path.join(scratch, 'image.json')))
    syms = []
    for line in open(os.path.join(scratch, 'symbols.tsv')):
        if line.startswith('#'): continue
        a, seg, kind, mod, name = line.rstrip('\n').split('\t')
        syms.append((int(a, 16), int(seg), int(kind), mod, name))
    syms.sort()
    return img, syms

def sym_lookup(syms):
    addrs = [s[0] for s in syms]
    byaddr = {}
    for s in syms: byaddr.setdefault(s[0], s[4])
    def name(a):
        i = bisect.bisect_right(addrs, a) - 1
        if i < 0: return None
        s = syms[i]
        off = a - s[0]
        if off > 0x40000: return None
        return s[4] if off == 0 else f'{s[4]}+{off:#x}'
    return byaddr, name

def run(scratch, only=None):
    img, syms = load(scratch)
    code = img['objects'][0]
    byaddr, name = sym_lookup(syms)
    codesyms = sorted(s[0] for s in syms if s[1] == 1)
    start, stop = code['base'], code['base'] + code['size']
    if only:
        a = next(s[0] for s in syms if s[4] == only)
        i = bisect.bisect_right(codesyms, a)
        start, stop = a, codesyms[i] if i < len(codesyms) else stop
    out = subprocess.run(['objdump', '-D', '-b', 'binary', '-m', 'i386', '-M', 'intel',
                          f'--adjust-vma={code["base"]:#x}', f'--start-address={start:#x}', f'--stop-address={stop:#x}',
                          os.path.join(scratch, 'obj1.bin')], capture_output=True, text=True, check=True).stdout
    hexre = re.compile(r'0x([0-9a-f]{5,8})\b')
    res = []
    for line in out.splitlines():
        m = re.match(r'\s*([0-9a-f]+):\t', line)
        if not m: continue
        a = int(m.group(1), 16)
        if a in byaddr: res.append(f'\n{byaddr[a]}:')
        def sub(mm):
            v = int(mm.group(1), 16)
            n = name(v)
            return f'{mm.group(0)}<{n}>' if n else mm.group(0)
        res.append(hexre.sub(sub, line))
    return '\n'.join(res) + '\n'

if __name__ == '__main__':
    scratch = sys.argv[1]
    if len(sys.argv) > 2:
        sys.stdout.write(run(scratch, sys.argv[2]))
    else:
        open(os.path.join(scratch, 'disasm.txt'), 'w').write(run(scratch))
