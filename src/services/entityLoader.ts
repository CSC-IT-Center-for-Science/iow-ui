import { IHttpService, IPromise, IQService } from 'angular';
import { ModelService } from './modelService';
import { ClassService } from './classService';
import { PredicateService } from './predicateService';
import { UserService } from './userService';
import { ResetService } from './resetService';
import { Uri, Url } from '../entities/uri';
import { DataType } from '../entities/dataTypes';
import { identity } from '../utils/function';
import { config } from '../../config';
import { Localizable } from '../entities/contract';
import { State, ConstraintType, KnownModelType, KnownPredicateType } from '../entities/type';
import { ImportedNamespace, Model } from '../entities/model';
import { Vocabulary, Concept } from '../entities/vocabulary';
import { Class, Property } from '../entities/class';
import { User } from '../entities/user';
import { Predicate, Association, Attribute } from '../entities/predicate';
import { VocabularyService } from './vocabularyService';
import { first, keepMatching } from '../utils/array';
import { requireDefined } from '../utils/object';

export const asiaConceptId = new Uri('http://jhsmeta.fi/skos/J392', {});
export const ktkGroupId = new Uri('https://tt.eduuni.fi/sites/csc-iow#KTK', {});
export const jhsGroupId = new Uri('https://tt.eduuni.fi/sites/csc-iow#JHS', {});

export type Resolvable<T> = IPromise<T>|(() => IPromise<T>);
export type UriResolvable<T extends { id: Uri }> = Url|IPromise<T>|(() => IPromise<T>);

export interface EntityDetails {
  label?: Localizable;
  comment?: Localizable;
  state?: State;
}

export interface ExternalNamespaceDetails {
  prefix: string;
  namespace: Url;
  label: string;
}

export interface ModelDetails extends EntityDetails {
  label: Localizable;
  prefix: string;
  vocabularies?: string[];
  namespaces?: (UriResolvable<Model>|ExternalNamespaceDetails)[];
}

export interface ConstraintDetails {
  type: ConstraintType;
  comment: Localizable;
  shapes: Resolvable<Class>[];
}

export interface ClassDetails extends EntityDetails {
  label: Localizable;
  id?: string;
  subClassOf?: UriResolvable<Class>;
  concept?: Url|ConceptSuggestionDetails;
  equivalentClasses?: UriResolvable<Class>[];
  properties?: PropertyDetails[];
  constraint?: ConstraintDetails;
}

export interface ShapeDetails extends EntityDetails {
  class: UriResolvable<Class>;
  id?: string;
  equivalentClasses?: UriResolvable<Class>[];
  propertyFilter?: (accept: Property) => boolean;
  properties?: PropertyDetails[];
  constraint?: ConstraintDetails;
}

export interface PredicateDetails extends EntityDetails {
  label: Localizable;
  id?: string;
  subPropertyOf?: UriResolvable<Predicate>;
  concept?: string|ConceptSuggestionDetails;
  equivalentProperties?: UriResolvable<Predicate>[];
}

export interface AttributeDetails extends PredicateDetails {
  dataType?: DataType;
}

export interface AssociationDetails extends PredicateDetails {
  valueClass?: UriResolvable<Class>;
}

export interface PropertyDetails extends EntityDetails {
  predicate: UriResolvable<Predicate>;
  example?: string;
  dataType?: DataType;
  valueClass?: UriResolvable<Class>;
  minCount?: number;
  maxCount?: number;
  pattern?: string;
  internalId?: string;
}

export interface ConceptSuggestionDetails {
  label: string;
  comment: string;
}

export class EntityLoaderService {
  /* @ngInject */
  constructor(private $q: IQService,
              private $http: IHttpService,
              private modelService: ModelService,
              private predicateService: PredicateService,
              private classService: ClassService,
              private userService: UserService,
              private vocabularyService: VocabularyService,
              private resetService: ResetService) {
  }

  create(context: any, shouldReset: boolean): EntityLoader {
    return new EntityLoader(this.$q, this.$http, this.modelService, this.predicateService, this.classService, this.userService, this.vocabularyService, this.resetService, context, shouldReset);
  }
}

export class EntityLoader {

  private reset: IPromise<any>;
  private loggedIn: IPromise<any>;
  private vocabularies: IPromise<any>;
  private actions: IPromise<any>[] = [];

  constructor(private $q: IQService,
              private $http: IHttpService,
              private modelService: ModelService,
              private predicateService: PredicateService,
              private classService: ClassService,
              private userService: UserService,
              private vocabularyService: VocabularyService,
              resetService: ResetService,
              private context: any,
              shouldReset: boolean) {

    this.reset = shouldReset ? resetService.reset() : $q.when();
    this.loggedIn = this.reset.then(() => this.login());
    this.vocabularies = this.reset.then(() => this.vocabularyService.getAllVocabularies());
  }

  login(): IPromise<User> {
    return this.userService.updateLogin().then((user: User) => {
      return !user.isLoggedIn()
        ? this.$http.get(config.apiEndpoint + '/login', { params: { target: 'http://dummy' } }).then(() => this.userService.updateLogin())
        : this.$q.when(this.userService.user);
    });
  }

  addAction<T>(action: IPromise<T>, details: any): IPromise<T> {
    const withDetails = action.then(identity, failWithDetails(details));
    this.actions.push(withDetails);
    return withDetails;
  }

  createUri(value: string) {
    return new Uri(value, this.context);
  }

  get result(): IPromise<any> {
    return this.$q.all(this.actions);
  }

  createConceptSuggestion(details: ConceptSuggestionDetails, modelPromise: IPromise<Model>): IPromise<Concept> {
    const result = this.loggedIn.then(() => modelPromise)
      .then((model: Model) => this.vocabularyService.createConceptSuggestion(model.modelVocabularies[0].vocabulary, details.label, details.comment, null, 'fi', model));

    return this.addAction(result, details);
  }

  getModel(id: Uri|Url) {
    return this.modelService.getModelByUrn(id);
  }

  createModel(type: KnownModelType, groupId: Uri, details: ModelDetails): IPromise<Model> {
    const result = this.loggedIn
      .then(() => this.modelService.newModel(details.prefix, details.label['fi'], groupId, ['fi', 'en'], type))
      .then(model => {
        setDetails(model, details);

        const promises: IPromise<any>[] = [];

        for (const importedVocabulary of details.vocabularies || []) {
          promises.push(
            this.vocabularies.then((vocabularies: Vocabulary[]) => {
                const vocabulary = first(vocabularies, (vocabulary: Vocabulary) => vocabulary.id.toString() === importedVocabulary);
                if (!vocabulary) {
                  throw new Error('Vocabulary not found: ' + vocabulary);
                }
                return vocabulary;
              })
              .then(vocabularyEntity => model.addVocabulary(vocabularyEntity))
          );
        }

        for (const ns of details.namespaces || []) {

          if (isUriResolvable(ns)) {
            promises.push(
              asUriPromise(assertExists(ns, 'namespace for ' + model.label['fi']), this.context)
                .then(importedNamespace => this.$q.all([this.$q.when(importedNamespace), this.modelService.getAllImportableNamespaces()]))
                .then(([importedNamespace, importableNamespaces]: [Uri, ImportedNamespace[]]) => model.addNamespace(requireDefined(first(importableNamespaces, ns => ns.id.equals(importedNamespace)))))
            );
          } else if (isExternalNamespace(ns)) {
            promises.push(this.modelService.newNamespaceImport(ns.namespace, ns.prefix, ns.label, 'fi')
              .then(newImportedNamespace => model.addNamespace(newImportedNamespace))
            );
          } else {
            throw new Error('Unknown namespace: ' + ns);
          }
        }

        return this.$q.all(promises)
          .then(() => this.modelService.createModel(model))
          .then(() => model);
      });

    return this.addAction(result, details);
  }

  createLibrary(groupId: Uri, details: ModelDetails): IPromise<Model> {
    return this.createModel('library', groupId, details);
  }

  createProfile(groupId: Uri, details: ModelDetails): IPromise<Model> {
    return this.createModel('profile', groupId, details);
  }

  getClass(modelPromise: IPromise<Model>, id: Uri|Url) {
    return modelPromise.then(model => this.classService.getClass(id, model));
  }

  assignClass(modelPromise: IPromise<Model>, classPromise: IPromise<Class>): IPromise<Class> {
    const result = this.loggedIn
      .then(() => this.$q.all([modelPromise, classPromise]))
      .then(([model, klass]: [Model, Class]) => this.classService.assignClassToModel(klass.id, model).then(() => klass));

    return this.addAction(result, 'assign class');
  }

  specializeClass(modelPromise: IPromise<Model>, details: ShapeDetails): IPromise<Class> {
    const result = this.loggedIn
      .then(() =>  this.$q.all([modelPromise, asUriPromise(assertExists(details.class, 'class to specialize for ' + details.class.toString()))]))
      .then(([model, classId]: [Model, Uri]) => this.classService.getClass(classId, model).then(klass => [model, klass]))
      .then(([model, klass]: [Model, Class]) => {
        return this.classService.newShape(klass, model, false, 'fi')
          .then(shape => {
            setDetails(shape, details);
            setId(shape, details);

            const promises: IPromise<any>[] = [];

            for (const property of details.properties || []) {
              promises.push(this.createProperty(modelPromise, property).then(property => {
                shape.addProperty(property);
              }));
            }

            if (details.propertyFilter && details.properties) {
              throw new Error('Shape cannot declare both properties and property filter');
            }

            if (details.propertyFilter) {
              keepMatching(shape.properties, details.propertyFilter);
            }

            for (const equivalentClass of details.equivalentClasses || []) {
              promises.push(asUriPromise(assertExists(equivalentClass, 'equivalent class for ' + details.class.toString()), this.context, shape.context).then(id => shape.equivalentClasses.push(id)));
            }

            if (details.constraint) {
              shape.constraint.constraint = details.constraint.type;
              shape.constraint.comment = details.constraint.comment;

              for (const constraintShape of details.constraint.shapes) {
                promises.push(asPromise(assertExists(constraintShape, 'constraint item for ' + details.class.toString())).then(item => shape.constraint.addItem(item)));
              }
            }

            return this.$q.all(promises)
              .then(() => this.classService.createClass(shape))
              .then(() => shape);
          });
      });

    return this.addAction(result, details);
  }

  createClass(modelPromise: IPromise<Model>, details: ClassDetails): IPromise<Class> {

    const concept = details.concept;
    const conceptIdPromise = isConceptSuggestion(concept)
      ? this.createConceptSuggestion(concept, modelPromise).then(conceptSuggestion => conceptSuggestion.id)
      : concept ? this.$q.when(this.createUri(<string> concept)) : this.$q.when(asiaConceptId);

    const result = this.loggedIn
      .then(() =>  this.$q.all([modelPromise, conceptIdPromise]))
      .then(([model, conceptId]: [Model, Uri]) => this.classService.newClass(model, details.label['fi'], conceptId, 'fi'))
      .then((klass: Class) => {
        setDetails(klass, details);
        setId(klass, details);

        const promises: IPromise<any>[] = [];

        for (const property of details.properties || []) {
          promises.push(this.createProperty(modelPromise, property).then(property => klass.addProperty(property)));
        }

        assertPropertyValueExists(details, 'subClassOf for ' + details.label['fi']);
        promises.push(asUriPromise(details.subClassOf!, this.context, klass.context).then(uri => klass.subClassOf = uri));

        for (const equivalentClass of details.equivalentClasses || []) {
          promises.push(asUriPromise(assertExists(equivalentClass, 'equivalent class for ' + details.label['fi']), this.context, klass.context).then(uri => klass.equivalentClasses.push(uri)));
        }

        if (details.constraint) {
          klass.constraint.constraint = details.constraint.type;
          klass.constraint.comment = details.constraint.comment;

          for (const constraintShape of details.constraint.shapes) {
            promises.push(asPromise(assertExists(constraintShape, 'constraint item for ' + details.label['fi'])).then(item => klass.constraint.addItem(item)));
          }
        }

        return this.$q.all(promises)
          .then(() => this.classService.createClass(klass))
          .then(() => klass);
      });

    return this.addAction(result, details);
  }

  getPredicate(modelPromise: IPromise<Model>, id: Uri|Url) {
    return modelPromise.then(model => this.predicateService.getPredicate(id, model));
  }

  assignPredicate(modelPromise: IPromise<Model>, predicatePromise: IPromise<Predicate>): IPromise<Predicate> {
    const result = this.loggedIn
      .then(() =>  this.$q.all([modelPromise, predicatePromise]))
      .then(([model, predicate]: [Model, Predicate]) => this.predicateService.assignPredicateToModel(predicate.id, model).then(() => predicate));

    return this.addAction(result, 'assign predicate');
  }

  createPredicate<T extends Attribute|Association>(modelPromise: IPromise<Model>, type: KnownPredicateType, details: PredicateDetails, mangler: (predicate: T) => IPromise<any>): IPromise<T> {

    const concept = details.concept;
    const conceptIdPromise = isConceptSuggestion(concept)
      ? this.createConceptSuggestion(concept, modelPromise).then(conceptSuggestion => conceptSuggestion.id)
      : concept ? this.$q.when(this.createUri(<string> concept)) : this.$q.when(asiaConceptId);

    const result = this.loggedIn
      .then(() =>  this.$q.all([modelPromise, conceptIdPromise]))
      .then(([model, conceptId]: [Model, Uri]) => this.predicateService.newPredicate(model, details.label['fi'], conceptId, type, 'fi'))
      .then((predicate: T) => {
        setDetails(predicate, details);
        setId(predicate, details);

        const promises: IPromise<any>[] = [];

        assertPropertyValueExists(details, 'subPropertyOf for ' + details.label['fi]']);
        promises.push(asUriPromise(details.subPropertyOf!, this.context, predicate.context).then(uri => predicate.subPropertyOf = uri));

        for (const equivalentProperty of details.equivalentProperties || []) {
          promises.push(asUriPromise(assertExists(equivalentProperty, 'equivalent property for ' + details.label['fi']), this.context, predicate.context).then(uri => predicate.equivalentProperties.push(uri)));
        }

        promises.push(mangler(predicate));

        return this.$q.all(promises)
          .then(() => this.predicateService.createPredicate(predicate))
          .then(() => predicate);
      });

    return this.addAction(result, details);
  }

  createAttribute(modelPromise: IPromise<Model>, details: AttributeDetails): IPromise<Attribute> {
    return this.createPredicate<Attribute>(modelPromise, 'attribute', details, attribute => {
      attribute.dataType = details.dataType || 'xsd:string';
      return this.$q.when();
    });
  }

  createAssociation(modelPromise: IPromise<Model>, details: AssociationDetails): IPromise<Association> {
    return this.createPredicate<Association>(modelPromise, 'association', details, association => {
      assertPropertyValueExists(details, 'valueClass');
      return asUriPromise(details.valueClass!, this.context, association.context)
        .then(uri => association.valueClass = uri);
    });
  }

  createProperty(modelPromise: IPromise<Model>, details: PropertyDetails): IPromise<Property> {
    const result = this.loggedIn
      .then(() => this.$q.all([modelPromise, asUriPromise(assertExists(details.predicate, 'predicate'))]))
      .then(([model, predicateId]: [Model, Uri]) => this.predicateService.getPredicate(predicateId, model).then(predicate => [model, predicate]))
      .then(([model, p]: [Model, Predicate]) => {
        if (p.normalizedType === 'property') {
          throw new Error('Type must not be property');
        }
        return this.classService.newProperty(p, p.normalizedType, model);
      })
      .then((p: Property) => {
        setDetails(p, details);
        assertPropertyValueExists(details, 'valueClass');
        const valueClassPromise = asUriPromise(details.valueClass!, this.context, p.context).then(id => {
          if (id) {
            p.valueClass = id;
          }
        });

        if (details.internalId) {
          p.internalId = Uri.fromUUID(details.internalId);
        }

        if (details.dataType) {
          p.dataType = details.dataType;
        }

        p.example = details.example ? [details.example] : [];
        p.minCount = details.minCount || null;
        p.maxCount = details.maxCount || null;
        p.pattern = details.pattern || null;

        return valueClassPromise.then(() => p);
      });

    return this.addAction(result, details);
  }
}

function failWithDetails(details: any): (err: any) => void {
  return (error: any) => {
    return Promise.reject({ error, details });
  };
}

function setDetails(entity: { label: Localizable, comment: Localizable, state: State|null }, details: EntityDetails) {
  if (details.label) {
    entity.label = details.label;
  }

  if (details.comment) {
    entity.comment = details.comment;
  }

  if (details.state) {
    entity.state = details.state;
  }
}

function setId(entity: { id: Uri }, details: { id?: string }) {
  if (details.id) {
    entity.id = entity.id.withName(details.id);
  }
}

function assertPropertyValueExists(obj: any, property: string) {
  if (obj.hasOwnProperty(property)) {
    return assertExists(obj[property], ' property: ' + property);
  }

  return obj[property];
}

function assertExists<T>(obj: T, msg: string): T {
  if (obj === null || obj === undefined) {
    throw new Error('Null or undefined: ' + msg);
  }
  return obj;
}

function isPromise<T>(obj: any): obj is IPromise<T> {
  return !!(obj && obj.then);
}

function isPromiseProvider<T>(obj: any): obj is (() => IPromise<T>) {
  return typeof obj === 'function';
}

function isConceptSuggestion(obj: any): obj is ConceptSuggestionDetails {
  return typeof obj === 'object';
}

function isExternalNamespace(obj: any): obj is ExternalNamespaceDetails {
  return !!obj.label && !!obj.namespace && !!obj.prefix;
}

function isUriResolvable<T>(obj: any): obj is UriResolvable<T> {
  return typeof obj === 'string' || isPromiseProvider(obj) || isPromise(obj);
}

function asUriPromise<T extends { id: Uri }>(resolvable: UriResolvable<T>, ...contexts: any[]): IPromise<Uri> {
  if (isPromiseProvider(resolvable)) {
    const promise = resolvable();
    if (isPromise<T>(promise)) {
      return promise.then(withId => withId.id);
    } else {
      throw new Error('Must be promise');
    }
  } else if (isPromise(resolvable)) {
    return resolvable.then(withId => withId.id);
  } else if (typeof resolvable === 'string') {

    const uriContext: any = {};

    for (const context of contexts) {
      Object.assign(uriContext, context);
    }

    return <IPromise<Uri>> <any> Promise.resolve(new Uri(resolvable, Object.assign({}, uriContext)));
  } else {
    return <IPromise<Uri>> <any> Promise.resolve(null);
  }
}

function asPromise<T>(resolvable: Resolvable<T>): IPromise<T> {
  if (isPromiseProvider<T>(resolvable)) {
    return resolvable();
  } else if (isPromise<T>(resolvable)) {
    return resolvable;
  } else {
    throw new Error('Not resolvable: ' + resolvable);
  }
}
