from developer_test.rules import public_rules
from developer_test.tests.test_api import environment, authorize, picture


def test_rule_revision_is_stable_and_returned_objects_are_independent():
    first = public_rules()
    second = public_rules()
    assert first == second
    assert len(first['revision']) == 16
    first['detector']['scales'].clear()
    first['quality']['brightness_min'] = 0
    assert public_rules() == second


def test_health_contract_and_default_strategy(environment):
    client, _, engine = environment
    assert client.get('/api/dev/health').json()['rules'] == public_rules()
    response = client.post('/api/dev/recognize',files={'image':picture()},headers=authorize())
    assert response.status_code == 200
    assert engine.requested_scale == 'auto'
