const _ = require('lodash');
const Bloodhound = require('typeahead.js-browserify').Bloodhound;

module.exports = function modalFactory($uibModal) {
  'ngInject';

  return {
    open(references, defineConceptTitle) {
      return $uibModal.open({
        template: require('./searchConceptModal.html'),
        size: 'small',
        controller: SearchClassController,
        controllerAs: 'ctrl',
        resolve: {
          defineConceptTitle: () => defineConceptTitle,
          references: () => references
        }
      });
    }
  };
};

function SearchClassController($scope, $uibModalInstance, modelLanguage, gettextCatalog, defineConceptTitle, references) {
  'ngInject';

  const vm = this;

  vm.hasVocabularies = references.length > 0;
  vm.concept = null;
  vm.label = null;
  vm.defineConceptTitle = defineConceptTitle;

  vm.options = {
    hint: false,
    highlight: true,
    minLength: 3,
    editable: false
  };

  $scope.$watch('ctrl.concept', (concept) => {
    if (concept) {
      vm.label = concept.prefLabel;
    }
  });

  function identify(obj) {
    return obj.uri;
  }

  const limit = 1000;
  const estimatedDuplicateCount = 2;

  function limitResults(results) {
    return results.splice(0, Math.min(limit * estimatedDuplicateCount, results.length));
  }

  function createEngine(vocId) {
    return new Bloodhound({
      identify: identify,
      remote: {
        url: `/api/rest/conceptSearch?term=%QUERY&lang=${modelLanguage.getLanguage()}&vocid=${vocId}`,
        wildcard: '%QUERY',
        transform: (response) => _.uniq(limitResults(response.results), identify)
      },
      rateLimitBy: 'debounce',
      queryTokenizer: Bloodhound.tokenizers.whitespace,
      datumTokenizer: Bloodhound.tokenizers.whitespace
    });
  }

  function createDataset(reference) {
    const vocId = reference.vocabularyId;
    const label = modelLanguage.translate(reference.title);

    return {
      display: 'prefLabel',
      name: vocId,
      source: createEngine(vocId),
      limit: limit,
      templates: {
        empty: (search) => `<div class="empty-message">'${search.query}' ${gettextCatalog.getString('not found in the concept database')} ${label}</div>`,
        suggestion: (data) => `<div>${data.prefLabel} <p class="details">${data.uri}</p></div>`
      }
    };
  }

  vm.datasets = _.map(references, reference => createDataset(reference));

  vm.create = () => {
    $uibModalInstance.close({conceptId: vm.concept.uri, label: vm.label});
  };

  vm.cancel = () => {
    $uibModalInstance.dismiss();
  };
}
