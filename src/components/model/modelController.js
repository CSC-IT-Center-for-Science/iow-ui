const _ = require('lodash');
const utils = require('../../services/utils');

module.exports = function modelController($scope, $location, $routeParams, $log, $q, $uibModal, locationService, modelService, classService, predicateService, userService, searchClassModal, searchPredicateModal, editInProgressModal, languageService) {
  'ngInject';

  const vm = this;
  const views = [];

  vm.loading = true;
  vm.registerView = view => views.push(view);
  vm.select = select;
  vm.isSelected = listItem => listItem.isEqual(vm.selectedItem);
  vm.canEdit = userService.isLoggedIn;
  vm.addClass = addClass;
  vm.addPredicate = addPredicate;
  vm.glyphIconClassForType = utils.glyphIconClassForType;
  vm.associations = () => _.filter(vm.predicates, predicate => predicate.isAssociation());
  vm.attributes = () => _.filter(vm.predicates, predicate => predicate.isAttribute());

  init(routeData($routeParams));

  $scope.$on('$locationChangeSuccess', () => {
    if ($location.path() === '/models') {
      init(routeData($location.search()));
    }
  });

  $scope.$watch('ctrl.model', (newModel, oldModel) => {
    updateLocation();
    if (oldModel && !newModel) {
      $location.path('/groups');
      $location.search({urn: $routeParams.group});
    }
  });

  $scope.$watch('ctrl.selection', (newSelection, oldSelection) => {
    updateLocation();
    if (oldSelection && oldSelection.isEqual(newSelection) && !_.isEqual(oldSelection.label, newSelection.label)) {
      updateSelectables(); // a bit brute to update all even when just one label updated
    }
  });

  function updateLocation() {
    if (vm.model) {
      locationService.atModel(vm.model, vm.selection);

      if (!vm.model.unsaved) {
        const params = {urn: vm.model.id};
        if (vm.selection) {
          params[vm.selection.type] = vm.selection.id;
        }
        $location.search(params);
      }
    }
  }

  function routeData(params) {
    function newModel() {
      if (params.label && params.prefix && params.group) {
        return {label: params.label, prefix: params.prefix, groupId: params.group};
      }
    }

    function existingModelId() {
      return params.urn;
    }

    function selected() {
      for (const type of ['attribute', 'class', 'association']) {
        const id = params[type];
        if (id) {
          return {type, id};
        }
      }
    }

    return {newModel: newModel(), existingModelId: existingModelId(), selected: selected()};
  }

  function init({newModel, existingModelId, selected}) {
    vm.selectedItem = selected;
    vm.activeTab = selected ? {[selected.type]: true} : {class: true};

    (newModel
      ? updateNewModel(newModel)
      : $q.all([
        updateModelById(existingModelId).then(updateSelectables),
        updateSelectionByTypeAndId(selected)
      ])
    ).then(() => vm.loading = false);
  }

  function addClass() {
    const classMap = _.indexBy(vm.classes, klass => klass.id);
    searchClassModal.open(vm.model.references, classMap).result
      .then(result => {
        if (result.concept) {
          createClass(result);
        } else {
          assignClassToModel(result);
        }
      });
  }

  function createClass({concept, label}) {
    classService.newClass(vm.model, label, concept.id, languageService.getModelLanguage())
      .then(klass => updateSelection(klass));
  }

  function assignClassToModel(klass) {
    classService.assignClassToModel(klass.id, vm.model.id)
      .then(() => {
        updateSelection(klass);
        updateClasses();
      });
  }

  function addPredicate(type) {
    const predicateMap = _.indexBy(vm.predicates, (predicate) => predicate.id);
    searchPredicateModal.open(vm.model.references, type, predicateMap).result
      .then(result => {
        if (result.concept) {
          createPredicate(result);
        } else {
          assignPredicateToModel(result);
        }
      });
  }

  function createPredicate({concept, label, type}) {
    predicateService.newPredicate(vm.model, label, concept.id, type, languageService.getModelLanguage())
      .then(predicate => updateSelection(predicate));
  }

  function assignPredicateToModel(predicate) {
    predicateService.assignPredicateToModel(predicate.id, vm.model.id)
      .then(() => {
        updateSelection(predicate);
        updatePredicates();
      });
  }

  let selectionQueue = [];

  function select(listItem) {
    askPermissionWhenEditing(() => {
      vm.selectedItem = listItem;
      if (selectionQueue.length > 0) {
        selectionQueue.push(listItem);
      } else {
        selectionQueue.push(listItem);
        fetchUntilStable(listItem).then(selection => {
          selectionQueue = [];
          updateSelection(selection);
        });
      }
    });

    function fetchUntilStable(item) {
      return fetchEntityByTypeAndId(item).then(entity => {
        const last = selectionQueue[selectionQueue.length - 1];
        if (entity.isEqual(last)) {
          return entity;
        } else {
          return fetchUntilStable(last);
        }
      });
    }
  }

  function askPermissionWhenEditing(callback) {
    const editingViews = _.filter(views, view => view.isEditing());

    if (editingViews.length > 0) {
      editInProgressModal.open().result.then(() => {
        _.forEach(editingViews, view => view.cancelEditing());
        callback();
      });
    } else {
      callback();
    }
  }

  function updateSelectionByTypeAndId(selection) {
    if (selection) {
      return fetchEntityByTypeAndId(selection).then(updateSelection);
    } else {
      return $q.when(updateSelection(null));
    }
  }

  function fetchEntityByTypeAndId(selection) {
    if (!vm.selection || !vm.selection.isEqual(selection)) {
      return selection.type === 'class'
        ? classService.getClass(selection.id)
        : predicateService.getPredicate(selection.id);
    } else {
      return $q.when(vm.selection);
    }
  }

  function updateSelection(selection) {
    return $q.when(vm.selection = selection);
  }

  function updateModelById(modelId) {
    if (!vm.model || vm.model.id !== modelId) {
      return modelService.getModelByUrn(modelId).then(updateModel);
    } else {
      return $q.reject();
    }
  }

  function updateNewModel(newModel) {
    return modelService.newModel(newModel, languageService.getModelLanguage()).then(updateModel);
  }

  function updateModel(model) {
    return $q.when(vm.model = model);
  }

  function updateSelectables() {
    return $q.all([updateClasses(vm.model.id), updatePredicates(vm.model.id)]);
  }

  function updateClasses() {
    return classService.getClassesForModel(vm.model.id).then(classes => vm.classes = classes);
  }

  function updatePredicates() {
    return predicateService.getPredicatesForModel(vm.model.id).then(predicates => vm.predicates = predicates);
  }
};
