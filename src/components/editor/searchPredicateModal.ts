import IPromise = angular.IPromise;
import IQService = angular.IQService;
import IScope = angular.IScope;
import IModalService = angular.ui.bootstrap.IModalService;
import IModalServiceInstance = angular.ui.bootstrap.IModalServiceInstance;
import gettextCatalog = angular.gettext.gettextCatalog;
import * as _ from 'lodash';
import {
  Predicate, PredicateListItem, Model, Type, DefinedBy,
  AbstractPredicate, ExternalEntity
} from '../../services/entities';
import { PredicateService } from '../../services/predicateService';
import { SearchConceptModal, EntityCreation } from './searchConceptModal';
import { LanguageService, Localizer } from '../../services/languageService';
import { EditableForm } from '../form/editableEntityController';
import { comparingString, comparingBoolean, comparingLocalizable } from '../../services/comparators';
import { AddNew } from '../common/searchResults';
import { collectIds, glyphIconClassForType } from '../../utils/entity';

const noExclude = (item: PredicateListItem) => <string> null;

export class SearchPredicateModal {

  /* @ngInject */
  constructor(private $uibModal: IModalService) {
  }

  private openModal(model: Model, type: Type, exclude: (predicate: AbstractPredicate) => string, onlySelection: boolean) {
    return this.$uibModal.open({
      template: require('./searchPredicateModal.html'),
      size: 'large',
      controller: SearchPredicateController,
      controllerAs: 'ctrl',
      backdrop: true,
      resolve: {
        model: () => model,
        type: () => type,
        exclude: () => exclude,
        onlySelection: () => onlySelection
      }
    }).result;
  }

  open(model: Model, type: Type, exclude: (predicate: AbstractPredicate) => string = noExclude): IPromise<ExternalEntity|EntityCreation|Predicate> {
    return this.openModal(model, type, exclude, false);
  }

  openForProperty(model: Model, exclude: (predicate: AbstractPredicate) => string = noExclude): IPromise<ExternalEntity|Predicate> {
    return this.openModal(model, null, exclude, false);
  }

  openWithOnlySelection(model: Model, type: Type, exclude: (predicate: AbstractPredicate) => string = noExclude): IPromise<Predicate> {
    return this.openModal(model, type, exclude, true);
  }
};

export interface SearchPredicateScope extends IScope {
  form: EditableForm;
}

export class SearchPredicateController {

  private predicates: PredicateListItem[] = [];
  private currentModelPredicateIds: Set<string> = new Set<string>();

  editInProgress = () => this.$scope.form.editing && this.$scope.form.$dirty;
  close = this.$uibModalInstance.dismiss;
  searchResults: (PredicateListItem|AddNewPredicate)[] = [];
  selection: Predicate|ExternalEntity;
  searchText: string = '';
  showModel: DefinedBy|Model;
  models: (DefinedBy|Model)[] = [];
  types: Type[];
  typeSelectable: boolean;
  submitError: string;
  cannotConfirm: string;
  loadingResults: boolean;
  selectedItem: PredicateListItem|AddNewPredicate;

  // undefined means not fetched, null means does not exist
  externalPredicate: Predicate;

  private localizer: Localizer;

  /* @ngInject */
  constructor(private $scope: SearchPredicateScope,
              private $uibModalInstance: IModalServiceInstance,
              public model: Model,
              public type: Type,
              public exclude: (predicate: AbstractPredicate) => string,
              public onlySelection: boolean,
              private predicateService: PredicateService,
              languageService: LanguageService,
              private searchConceptModal: SearchConceptModal,
              private gettextCatalog: gettextCatalog) {

    this.localizer = languageService.createLocalizer(model);
    this.loadingResults = true;
    this.typeSelectable = !type;

    if (onlySelection) {
      this.showModel = model;
    }

    const appendResults = (predicates: PredicateListItem[]) => {
      this.predicates = this.predicates.concat(predicates);

      this.models = [this.model];
      this.models = this.models.concat(_.chain(this.predicates)
        .map(predicate => predicate.definedBy)
        .uniq(definedBy => definedBy.id.uri)
        .sort(comparingLocalizable<DefinedBy>(languageService.getModelLanguage(model), definedBy => definedBy.label))
        .value());

      this.types = _.chain(this.predicates)
        .map(predicate => predicate.normalizedType)
        .uniq()
        .value();

      this.search();

      this.loadingResults = false;
    };

    predicateService.getAllPredicates().then(appendResults);
    predicateService.getPredicatesForModel(model)
      .then(predicates => this.currentModelPredicateIds = collectIds(predicates))
      .then(() => this.search());

    if (this.canAddExternal()) {
      predicateService.getExternalPredicatesForModel(model).then(appendResults);
    }

    $scope.$watch(() => this.searchText, () => this.search());
    $scope.$watch(() => this.type, () => this.search());
    $scope.$watch(() => this.showModel, () => this.search());

    $scope.$watch(() => this.selection && this.selection.id, selectionId => {
      if (selectionId && this.selection instanceof ExternalEntity) {
        this.externalPredicate = undefined;
        predicateService.getExternalPredicate(selectionId, model).then(predicate => this.externalPredicate = predicate);
      }
    });
  }

  isThisModel(item: DefinedBy|Model) {
    return this.model === item;
  }

  canAddExternal() {
    return this.model.isOfType('profile') && this.typeSelectable;
  }

  get showExcluded() {
    return !!this.searchText;
  }

  isSelectionExternalEntity(): boolean {
    return this.selection instanceof ExternalEntity;
  }

  isSelectionPredicate(): boolean {
    return this.selection instanceof Predicate;
  }

  search() {
    const result: (PredicateListItem|AddNewPredicate)[] = [
      new AddNewPredicate(`${this.gettextCatalog.getString('Create new attribute')} '${this.searchText}'`, this.isAttributeAddable.bind(this), 'attribute', false),
      new AddNewPredicate(`${this.gettextCatalog.getString('Create new association')} '${this.searchText}'`, this.isAssociationAddable.bind(this), 'association', false),
      new AddNewPredicate(`${this.gettextCatalog.getString('Create new predicate')} ${this.gettextCatalog.getString('by referencing external uri')}`, () => this.canAddExternal() && (this.isAttributeAddable() || this.isAssociationAddable()), null, true)
    ];

    const predicateSearchResult = this.predicates.filter(predicate =>
      this.textFilter(predicate) &&
      this.modelFilter(predicate) &&
      this.typeFilter(predicate) &&
      this.excludedFilter(predicate)
    );

    predicateSearchResult.sort(
      comparingBoolean((item: PredicateListItem) => !!this.exclude(item))
        .andThen(comparingString(this.localizedLabelAsLower.bind(this))));

    this.searchResults = result.concat(predicateSearchResult);
  }

  selectItem(item: PredicateListItem|AddNewPredicate) {
    this.selectedItem = item;
    this.externalPredicate = undefined;
    this.submitError = null;
    this.$scope.form.editing = false;
    this.$scope.form.$setPristine();

    if (item instanceof AddNewPredicate) {
      if (item.external) {
        this.$scope.form.editing = true;
        this.selection = new ExternalEntity(this.localizer.language, this.searchText, this.type || 'attribute');
      } else {
        this.createNew(item.type);
      }
    } else if (item instanceof PredicateListItem) {
      this.cannotConfirm = this.exclude(item);

      if (this.model.isNamespaceKnownToBeNotModel(item.definedBy.id.url)) {
        this.predicateService.getExternalPredicate(item.id, this.model).then(result => this.selection = result);
      } else {
        this.predicateService.getPredicate(item.id, this.model).then(result => this.selection = result);
      }
    } else {
      throw new Error('Unsupported item: ' + item);
    }
  }

  loadingSelection(item: PredicateListItem|AddNew) {
    const selection = this.selection;
    if (item instanceof PredicateListItem) {
      return item === this.selectedItem && (!selection || (selection instanceof Predicate && !item.id.equals(selection.id)));
    } else {
      return false;
    }
  }

  isExternalPredicatePending() {
    return this.isSelectionExternalEntity() && this.externalPredicate === undefined;
  }

  confirm() {
    const selection = this.selection;

    if (selection instanceof Predicate) {
      if (selection.unsaved) {
        this.predicateService.createPredicate(selection)
          .then(() => this.$uibModalInstance.close(selection), err => this.submitError = err.data.errorMessage);
      } else {
        this.$uibModalInstance.close(selection);
      }
    } else if (selection instanceof ExternalEntity) {
      if (this.externalPredicate) {
        const exclude = this.exclude(this.externalPredicate);
        if (exclude) {
          this.submitError = exclude;
        } else {
          this.$uibModalInstance.close(this.externalPredicate);
        }
      } else {
        this.$uibModalInstance.close(selection);
      }
    } else {
      throw new Error('Unsupported selection: ' + selection);
    }
  }

  createNew(type: Type) {
    return this.searchConceptModal.openNewEntityCreation(this.model.vocabularies, this.model, type, this.searchText)
      .then(result => {
        if (!this.typeSelectable) {
          this.$uibModalInstance.close(result);
        } else {
          this.predicateService.newPredicate(this.model, result.entity.label, result.concept.id, type, this.localizer.language)
            .then(predicate => {
              this.cannotConfirm = null;
              this.selection = predicate;
              this.$scope.form.editing = true;
            });
        }
      });
  }

  isEditing(): boolean {
    return this.$scope.form && this.$scope.form.editing;
  }

  isAttributeAddable(): boolean {
    return this.searchText && (this.typeSelectable || this.type === 'attribute');
  }

  isAssociationAddable(): boolean {
    return this.searchText && (this.typeSelectable || this.type === 'association');
  }

  private localizedLabelAsLower(predicate: PredicateListItem): string {
    return this.localizer.translate(predicate.label).toLowerCase();
  }

  private textFilter(predicate: PredicateListItem): boolean {
    return !this.searchText || this.localizedLabelAsLower(predicate).includes(this.searchText.toLowerCase());
  }

  private modelFilter(predicate: PredicateListItem): boolean {
    if (!this.showModel) {
      return true;
    } else if (this.showModel === this.model) {
      return this.currentModelPredicateIds.has(predicate.id.uri);
    } else {
      return predicate.definedBy.id.equals(this.showModel.id);
    }
  }

  private typeFilter(predicate: PredicateListItem): boolean {
    return !this.type || predicate.normalizedType === this.type;
  }

  private excludedFilter(predicate: PredicateListItem): boolean {
    return this.showExcluded || !this.exclude(predicate);
  }
}

class AddNewPredicate extends AddNew {
  constructor(public label: string, public show: () => boolean, public type: Type, public external: boolean) {
    super(label, show, glyphIconClassForType([type]));
  }
}
