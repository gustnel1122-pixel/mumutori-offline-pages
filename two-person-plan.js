(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.OfflineTwoPerson = api;
})(typeof window === 'undefined' ? globalThis : window, function () {
  'use strict';
  const owners = ['현수', '다희', '둘이'];
  const current = {
    'design-02': ['현수', '자료·실측 미확인점 정리'],
    'design-03': ['둘이', '도면과 목업을 합쳐 배치 검토'],
    'design-07': ['다희', '목업의 로고·인쇄 기준 확인'],
    'butter-01': ['둘이', '가운데 테이블·식탁보 제작 준비'],
    'build-05-v3': ['둘이', '집기 설치·동선 확인'],
    'goods-02': ['현수', '상품 입고·재고 확인'],
    'goods-05': ['둘이', '상품·가격표 배치'],
    'package-plan-v5': ['현수', '상품별 포장 준비'],
    'keyring-chain-v5': ['현수', '키링 체인 달기'],
    'ops-04-v3': ['둘이', '결제·환불·마감 시험'],
    'ops-05-v3': ['현수', '11/1 오픈 안내 확인']
  };
  function owner(task) { return owners.includes(task?.owner) ? task.owner : (current[task?.id]?.[0] || '둘이'); }
  // A view only: never rewrite or remove the shared definitions or completion records.
  function tasks(items, seeds, history) {
    const original = new Map(seeds.map(t => [t.id, t]));
    return items.filter(t => history || current[t.id] || !original.has(t.id)).map(t => ({
      ...t, owner: owner(t),
      title: !history && current[t.id] && t.title === original.get(t.id)?.title ? current[t.id][1] : t.title
    }));
  }
  return { owners, owner, tasks };
});
