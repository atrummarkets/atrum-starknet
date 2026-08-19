"""Serialise a Cairo ByteArray to calldata felts.

Layout: [num_full_words, *full_words(31 bytes each), pending_word, pending_len]
Getting this wrong produces 'Error while processing Cairo-like calldata' with no hint
about which argument, so it is worth having as a tested helper rather than inline.
"""
import sys

def ba(s: str):
    b = s.encode()
    words = [b[i:i+31] for i in range(0, len(b), 31)]
    full = words[:-1] if len(words[-1]) < 31 else words
    pending = words[-1] if len(words[-1]) < 31 else b""
    out = [len(full)]
    for w in full:
        out.append(int.from_bytes(w, "big"))
    out.append(int.from_bytes(pending, "big") if pending else 0)
    out.append(len(pending))
    return out

if __name__ == "__main__":
    for arg in sys.argv[1:]:
        print(" ".join(str(x) for x in ba(arg)))
