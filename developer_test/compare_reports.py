"""Compare recorded conditions and observations in two anonymous session reports."""
import argparse
import json
from pathlib import Path


def compare_reports(before,after):
    for report in [before,after]:
        if not isinstance(report,dict) or report.get('source')!='AEGIS Developer Test' or report.get('report_version')!=2:
            raise ValueError('Use dois relatórios AEGIS versão 2.')
        if not all(isinstance(report.get(key),dict) for key in ['configuration','runtime','camera','frames','evaluation','timings']):
            raise ValueError('O relatório está incompleto.')
    fields={
        'rules':lambda r:r['configuration'].get('rule_sets'),
        'gallery':lambda r:r['configuration'].get('gallery_revisions'),
        'profiles':lambda r:r['configuration'].get('profiles'),
        'scales':lambda r:r['configuration'].get('scales'),
        'thresholds':lambda r:r['configuration'].get('thresholds'),
        'input_sizes':lambda r:r['configuration'].get('input_sizes'),
        'expected_identities':lambda r:r['configuration'].get('expected_identities'),
        'camera':lambda r:r['camera'],
        'threads':lambda r:r['runtime'].get('threads'),
        'backend':lambda r:r['configuration'].get('provenance'),
        'interface':lambda r:r['configuration'].get('client_revisions'),
    }
    changed=[]
    unavailable=[]
    for key,extract in fields.items():
        first,second=extract(before),extract(after)
        if first in (None,[],{}) or second in (None,[],{}):
            unavailable.append(key)
        elif first!=second:
            changed.append(key)
    mixed=any(len(report['configuration'].get(key,[]))>1 for report in [before,after] for key in ['gallery_revisions','rule_sets','provenance','client_revisions'])
    def difference(key):
        first=before['timings'].get(key,{}).get('median')
        second=after['timings'].get(key,{}).get('median')
        return round(second-first,2) if all(isinstance(value,(float,int)) for value in [first,second]) else None
    return {
        'same_recorded_parameters':not changed and not unavailable and not mixed,
        'changed_parameters':changed,'unavailable_parameters':unavailable,'mixed_versions_or_galleries':mixed,
        'before':{'captures':before['frames'].get('total'),'scored':before['evaluation'].get('scored'),'false_positives':before['evaluation'].get('fp'),'false_negatives':before['evaluation'].get('fn')},
        'after':{'captures':after['frames'].get('total'),'scored':after['evaluation'].get('scored'),'false_positives':after['evaluation'].get('fp'),'false_negatives':after['evaluation'].get('fn')},
        'median_change_ms':{key:difference(key) for key in ['total_ms','detect_ms','embedding_ms','roundtrip_ms']},
        'limitations':[
            'Parâmetros registrados iguais não comprovam participantes, iluminação, distância ou movimento iguais.',
            'Revisões de galeria são rótulos aleatórios do banco em execução. Reiniciar o serviço exige conferir novamente as referências.',
            'Contagens e tempos são observações de cada sessão. Quadros correlacionados não demonstram melhora de precisão geral.',
        ],
    }


def main():
    parser=argparse.ArgumentParser(description='Comparar resumos anônimos AEGIS sem acessar fotos ou banco.')
    parser.add_argument('before',type=Path)
    parser.add_argument('after',type=Path)
    arguments=parser.parse_args()
    try:
        reports=[json.loads(path.read_text(encoding='utf-8')) for path in [arguments.before,arguments.after]]
        result=compare_reports(*reports)
    except (OSError,ValueError,TypeError) as error:
        parser.error(str(error))
    print(json.dumps(result,ensure_ascii=False,indent=2))


if __name__=='__main__':
    main()
