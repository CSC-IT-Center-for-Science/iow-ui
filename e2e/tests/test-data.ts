import { Language } from '../../src/utils/language';
import { GroupPage } from '../pages/group/groupPage.po';
import { KnownModelType } from '../../src/entities/type';

export const library1Parameters = {
  label: 'E2E Kirjasto',
  prefix: 'e2e',
  language: ['fi', 'en'] as Language[],
  groupId: GroupPage.JHS_ID,
  type: 'library' as KnownModelType,
  classes: {
    first: {
      name: 'Luokka 1'
    }
  },
  attributes: {
    first: {
      name: 'Attribuutti 1'
    }
  },
  associations: {
    first: {
      name: 'Assosiaatio 1'
    }
  }
};

export const library2Parameters = {
  label: 'E2E Kirjasto2',
  prefix: 'e2e2',
  language: ['fi', 'en'] as Language[],
  groupId: GroupPage.JHS_ID,
  type: 'library' as KnownModelType
};
