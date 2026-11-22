"""Read the packed design-space datasets (web/data/{system}.bin + .json) in Python."""
import json
import os

import numpy as np

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DTYPES = {'f32': np.float32, 'u8': np.uint8, 'u16': np.uint16}


class Packed:
    def __init__(self, system):
        base = os.path.join(REPO, 'web', 'data', system)
        with open(base + '.json') as fh:
            self.meta = json.load(fh)
        buf = open(base + '.bin', 'rb').read()
        self.n = self.meta['rows']
        self.cols = {}
        for c in self.meta['columns']:
            arr = np.frombuffer(buf, dtype=DTYPES[c['dtype']], count=self.n, offset=c['offset'])
            self.cols[c['name']] = (arr, c['scale'], c['dtype'])
        with open(os.path.join(REPO, 'web', 'data', 'shapes.json')) as fh:
            self.shapes = list(json.load(fh)['shapes'])

    def get(self, name, r):
        arr, scale, dt = self.cols[name]
        v = arr[r]
        return float(v) if dt == 'f32' else float(v) / scale

    def shape(self, name, r):
        v = int(self.cols[name][0][r])
        return None if v == 65535 else self.shapes[v]
