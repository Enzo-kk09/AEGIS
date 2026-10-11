"""Reference comparisons shared by preflight and authoritative enrollment."""
import numpy as np

from .rules import CONSISTENCY_MIN, DUPLICATE_FACE_MIN, REDUNDANCY_MIN


def compare_references(vectors, known=None, photo_indices=None):
    indices = photo_indices or list(range(1, len(vectors)+1))
    matrix = np.stack(vectors) if len(vectors) else np.empty((0,128),dtype=np.float32)
    similarities = matrix @ matrix.T
    pairs = [
        {'first':indices[i],'second':indices[j],'similarity':round(float(similarities[i,j]),6),
         'consistent':bool(similarities[i,j] >= CONSISTENCY_MIN),
         'redundant':bool(similarities[i,j] >= REDUNDANCY_MIN)}
        for i in range(len(matrix)) for j in range(i+1,len(matrix))
    ]
    maximum = float(np.max(matrix @ known.T)) if len(matrix) and known is not None and len(known) else None
    return {
        'consistency':{'passed':all(pair['consistent'] for pair in pairs) if len(matrix) else None,
                       'minimum_similarity':min((pair['similarity'] for pair in pairs),default=None),
                       'required_similarity':CONSISTENCY_MIN,'pairs':pairs},
        'gallery':{'similar_to_existing':maximum is not None and maximum >= DUPLICATE_FACE_MIN,
                   'maximum_similarity':round(maximum,6) if maximum is not None else None,
                   'required_similarity':DUPLICATE_FACE_MIN},
        'redundant_pairs':sum(pair['redundant'] for pair in pairs),
    }
