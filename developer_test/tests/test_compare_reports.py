import copy
import pytest
from developer_test.compare_reports import compare_reports


def report():
    return {'source':'AEGIS Developer Test','report_version':2,
      'configuration':{'rule_sets':[{'revision':'rules'}],'gallery_revisions':['gallery'],'profiles':[{'label':'Perfil 1','references':3}],
                       'scales':['auto'],'thresholds':[.45],'input_sizes':['1280x720'],'expected_identities':['Perfil 1'],
                       'provenance':[{'backend_revision':'backend'}],'client_revisions':[10]},
      'runtime':{'threads':4},'camera':{'width':1280,'height':720,'frame_rate':30},
      'frames':{'total':100},'evaluation':{'scored':100,'fp':0,'fn':0},'timings':{'total_ms':{'median':70}}}


def test_comparison_reports_changes_without_inferring_accuracy_improvement():
    first=report()
    second=copy.deepcopy(first)
    second['timings']['total_ms']['median']=60
    comparison=compare_reports(first,second)
    assert comparison['same_recorded_parameters']
    assert comparison['median_change_ms']['total_ms']==-10
    second['runtime']['threads']=2
    second['configuration']['thresholds']=[.6]
    comparison=compare_reports(first,second)
    assert not comparison['same_recorded_parameters']
    assert set(comparison['changed_parameters'])=={'threads','thresholds'}
    assert 'iluminação' in comparison['limitations'][0]


def test_old_missing_or_mixed_metadata_does_not_claim_compatible_sessions():
    second=report()
    second['configuration']['gallery_revisions']=[]
    assert compare_reports(report(),second)['unavailable_parameters']==['gallery']
    second=report()
    second['configuration']['gallery_revisions']=['one','two']
    assert compare_reports(second,second)['mixed_versions_or_galleries']
    with pytest.raises(ValueError):
        compare_reports({'report_version':1},report())
